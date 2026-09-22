import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { db } from '../db'
import {
  accounts,
  expenseGroupMembers,
  expenseGroups,
  groupCategories,
  importRules,
  postings,
  transactions,
  userSettings,
} from '../db/schema'
import type { ErrorBody } from '../errors'
import { errorBody, fail, failWith } from '../errors'
import { cleanDescription, merchantKey } from '../import/merchant'

// Re-exported for callers that imported it from here before it moved to import/merchant.ts.
export { cleanDescription }

const app = new Hono<{ Variables: AppVariables }>()

// Resolves the target of a create/patch body into the columns to write.
//
// A rule targets exactly one of an expense account or a Fish Pie split; the two are
// mutually exclusive, so setting one clears the other. Returns a failure body instead of
// throwing, so the two routes that call it can send it with `failWith`. The status rides
// along in the registry rather than at each return, which is how the same failure used to
// get two different ones.
type TargetColumns = { accountId: string | null; groupId: string | null; categoryId: string | null }
async function resolveTarget(
  userId: string,
  body: Record<string, unknown>,
): Promise<{ columns: TargetColumns } | { failure: ErrorBody }> {
  const hasAccount = body.accountId != null
  const hasGroup = body.groupId != null

  if (hasAccount && hasGroup) {
    return { failure: errorBody('RULE_TARGET_AMBIGUOUS') }
  }
  if (!hasAccount && !hasGroup) {
    return { failure: errorBody('RULE_TARGET_MISSING') }
  }

  if (hasAccount) {
    if (typeof body.accountId !== 'string')
      return { failure: errorBody('FIELD_NOT_UUID', { field: 'accountId' }) }
    if (body.categoryId != null) {
      return { failure: errorBody('RULE_CATEGORY_WITHOUT_GROUP') }
    }
    const [owned] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, body.accountId),
          eq(accounts.userId, userId),
          isNull(accounts.deletedAt),
        ),
      )
    if (!owned) return { failure: errorBody('ACCOUNT_NOT_FOUND') }
    return { columns: { accountId: body.accountId, groupId: null, categoryId: null } }
  }

  if (typeof body.groupId !== 'string')
    return { failure: errorBody('FIELD_NOT_UUID', { field: 'groupId' }) }

  // The rule may only target a group the user is actually in — otherwise an import
  // could post into a stranger's shared ledger.
  const [membership] = await db
    .select({ id: expenseGroupMembers.id })
    .from(expenseGroupMembers)
    .innerJoin(expenseGroups, eq(expenseGroups.id, expenseGroupMembers.groupId))
    .where(
      and(
        eq(expenseGroupMembers.groupId, body.groupId),
        eq(expenseGroupMembers.userId, userId),
        isNull(expenseGroups.deletedAt),
      ),
    )
  if (!membership) return { failure: errorBody('NOT_A_GROUP_MEMBER') }

  if (body.categoryId == null) {
    return { columns: { accountId: null, groupId: body.groupId, categoryId: null } }
  }
  if (typeof body.categoryId !== 'string')
    return { failure: errorBody('FIELD_NOT_UUID', { field: 'categoryId' }) }

  // A category is only meaningful inside its own group, and an archived one would
  // produce expenses the user can no longer categorize by hand.
  const [category] = await db
    .select({ id: groupCategories.id, archivedAt: groupCategories.archivedAt })
    .from(groupCategories)
    .where(and(eq(groupCategories.id, body.categoryId), eq(groupCategories.groupId, body.groupId)))
  if (!category) return { failure: errorBody('CATEGORY_NOT_IN_GROUP') }
  if (category.archivedAt) return { failure: errorBody('CATEGORY_ARCHIVED') }

  return { columns: { accountId: null, groupId: body.groupId, categoryId: body.categoryId } }
}

// Shared select shape for rule listings. Left joins throughout: a rule has exactly one
// target, so the columns for the other kind are always null.
const ruleColumns = {
  id: importRules.id,
  pattern: importRules.pattern,
  accountId: importRules.accountId,
  accountPath: accounts.path,
  accountName: accounts.name,
  groupId: importRules.groupId,
  groupName: expenseGroups.name,
  categoryId: importRules.categoryId,
  categoryName: groupCategories.name,
  status: importRules.status,
  matchCount: importRules.matchCount,
  createdAt: importRules.createdAt,
  updatedAt: importRules.updatedAt,
}

// GET /api/rules
// Returns all non-deleted rules (active + suggested + denied) for the current user,
// with the display fields for whichever target kind each rule uses.
app.get('/', async (c) => {
  const userId = c.get('userId')

  const rules = await db
    .select(ruleColumns)
    .from(importRules)
    .leftJoin(accounts, eq(importRules.accountId, accounts.id))
    .leftJoin(expenseGroups, eq(importRules.groupId, expenseGroups.id))
    .leftJoin(groupCategories, eq(importRules.categoryId, groupCategories.id))
    .where(and(eq(importRules.userId, userId), isNull(importRules.deletedAt)))

  return c.json(rules)
})

// POST /api/rules
// Creates a rule manually. status defaults to 'active'.
// Body: { pattern: string } plus exactly one target:
//   { accountId } — post to an expense account
//   { groupId, categoryId? } — split into a Fish Pie group
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { pattern } = body

  if (!pattern || typeof pattern !== 'string')
    return fail(c, 'FIELD_REQUIRED', { field: 'pattern' })

  const target = await resolveTarget(userId, body)
  if ('failure' in target) return failWith(c, target.failure)

  const [created] = await db
    .insert(importRules)
    .values({ userId, pattern, ...target.columns, status: 'active' })
    .returning()

  return c.json(created, 201)
})

// POST /api/rules/mine
// Analyzes transaction history and writes new 'suggested' rules.
// Considers any transaction with exactly one expense posting (regular, Fish Pie, and
// multi-currency conversions all qualify — they each have a single expense leg).
// Descriptions are normalized (see cleanDescription) before grouping so near-duplicates
// from the same merchant accumulate matches together.
// Skips descriptions already covered by any existing non-deleted rule.
// Returns { created: number }.
app.post('/mine', async (c) => {
  const userId = c.get('userId')

  const [settings] = await db
    .select({ defaultExpensesRootPath: userSettings.defaultExpensesRootPath })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  const expensesRoot = settings?.defaultExpensesRootPath ?? 'expenses'

  // Fetch all postings for non-deleted transactions, with account paths
  const rows = await db
    .select({
      txId: transactions.id,
      description: transactions.description,
      accountId: postings.accountId,
      accountPath: accounts.path,
    })
    .from(transactions)
    .innerJoin(
      postings,
      and(eq(postings.transactionId, transactions.id), isNull(postings.deletedAt)),
    )
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))

  // Group postings by transaction id
  const byTx = new Map<
    string,
    { description: string | null; postings: { accountId: string; accountPath: string }[] }
  >()
  for (const row of rows) {
    if (!byTx.has(row.txId)) byTx.set(row.txId, { description: row.description, postings: [] })
    byTx.get(row.txId)!.postings.push({ accountId: row.accountId, accountPath: row.accountPath })
  }

  // Count (normalized description, expenseAccountId) pairs. Any transaction with exactly
  // one expense posting qualifies — this admits Fish Pie and multi-currency conversions
  // (multiple postings, one expense leg), not just plain 2-posting transactions. A
  // transaction with zero or several expense legs is ambiguous, so it is skipped.
  const pairCounts = new Map<string, { pattern: string; accountId: string; count: number }>()
  for (const { description, postings: txPostings } of byTx.values()) {
    if (!description) continue
    const expensePostings = txPostings.filter((p) => p.accountPath.startsWith(`${expensesRoot}:`))
    const expensePosting = expensePostings[0]
    // Exactly one expense leg, or the transaction says nothing about which account a
    // pattern maps to.
    if (expensePostings.length !== 1 || !expensePosting) continue
    // Same normalization the import preview stamps as merchantKey, so a mined pattern
    // and the preview cluster it covers are the same string.
    const pattern = merchantKey(description)
    if (!pattern) continue
    const key = `${pattern.toLowerCase()}|||${expensePosting.accountId}`
    const existing = pairCounts.get(key)
    if (existing) existing.count++
    else pairCounts.set(key, { pattern, accountId: expensePosting.accountId, count: 1 })
  }

  // For each unique normalized pattern, keep the (pattern, account) pair with the highest count
  const bestByPattern = new Map<string, { pattern: string; accountId: string; count: number }>()
  for (const pair of pairCounts.values()) {
    const patternKey = pair.pattern.toLowerCase()
    const current = bestByPattern.get(patternKey)
    if (!current || pair.count > current.count) bestByPattern.set(patternKey, pair)
  }

  // Fetch existing non-deleted rules to skip already-covered descriptions
  const existingRules = await db
    .select({ pattern: importRules.pattern })
    .from(importRules)
    .where(and(eq(importRules.userId, userId), isNull(importRules.deletedAt)))
  const coveredPatterns = new Set(existingRules.map((r) => r.pattern.toLowerCase()))

  // Insert suggestions for uncovered patterns seen at least twice. A floor of 2 (rather
  // than 3) lets a first-ever import surface rules; normalization above means a "2" is a
  // genuine repeat of the same merchant, not two unrelated reference-laden descriptions.
  const toInsert = [...bestByPattern.values()].filter(
    (pair) => pair.count >= 2 && !coveredPatterns.has(pair.pattern.toLowerCase()),
  )

  if (toInsert.length > 0) {
    await db.insert(importRules).values(
      toInsert.map((pair) => ({
        userId,
        pattern: pair.pattern,
        accountId: pair.accountId,
        status: 'suggested' as const,
        matchCount: pair.count,
      })),
    )
  }

  return c.json({ created: toInsert.length })
})

// PATCH /api/rules/:id
// Updates the pattern and/or the target. At least one field required.
//
// The target is replaced wholesale, never merged: sending accountId on a split rule
// clears groupId and categoryId, and vice versa. Merging would let a partial patch
// leave a rule with both targets set, which is the one state the model forbids.
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const patch: Record<string, unknown> = {}

  if ('pattern' in body) {
    if (!body.pattern || typeof body.pattern !== 'string')
      return fail(c, 'FIELD_EMPTY', { field: 'pattern' })
    patch.pattern = body.pattern
  }

  if ('accountId' in body || 'groupId' in body || 'categoryId' in body) {
    const target = await resolveTarget(userId, body)
    if ('failure' in target) return failWith(c, target.failure)
    Object.assign(patch, target.columns)
  }

  if (Object.keys(patch).length === 0) return fail(c, 'NO_FIELDS_TO_UPDATE')

  patch.updatedAt = new Date()

  const [updated] = await db
    .update(importRules)
    .set(patch)
    .where(
      and(
        eq(importRules.id, c.req.param('id')),
        eq(importRules.userId, userId),
        isNull(importRules.deletedAt),
      ),
    )
    .returning()

  if (!updated) return fail(c, 'RULE_NOT_FOUND')
  return c.json(updated)
})

// DELETE /api/rules/:id
// Soft-deletes a rule.
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  await db
    .update(importRules)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(importRules.id, c.req.param('id')),
        eq(importRules.userId, userId),
        isNull(importRules.deletedAt),
      ),
    )
  return c.body(null, 204)
})

// POST /api/rules/:id/approve
// Flips a suggested rule to active.
app.post('/:id/approve', async (c) => {
  const userId = c.get('userId')

  const [updated] = await db
    .update(importRules)
    .set({ status: 'active', updatedAt: new Date() })
    .where(
      and(
        eq(importRules.id, c.req.param('id')),
        eq(importRules.userId, userId),
        isNull(importRules.deletedAt),
      ),
    )
    .returning()

  if (!updated) return fail(c, 'RULE_NOT_FOUND')
  return c.json(updated)
})

// POST /api/rules/:id/deny
// Hides a suggested rule by flipping it to 'denied'. The row is kept (not soft-deleted) so its
// pattern stays in mining's skip-set and is never re-suggested. Reversible via /revive.
app.post('/:id/deny', async (c) => {
  const userId = c.get('userId')

  const [updated] = await db
    .update(importRules)
    .set({ status: 'denied', updatedAt: new Date() })
    .where(
      and(
        eq(importRules.id, c.req.param('id')),
        eq(importRules.userId, userId),
        eq(importRules.status, 'suggested'),
        isNull(importRules.deletedAt),
      ),
    )
    .returning()

  if (!updated) return fail(c, 'RULE_NOT_FOUND')
  return c.json(updated)
})

// POST /api/rules/:id/revive
// Flips a denied rule back to 'suggested' so it reappears in the suggestions list.
app.post('/:id/revive', async (c) => {
  const userId = c.get('userId')

  const [updated] = await db
    .update(importRules)
    .set({ status: 'suggested', updatedAt: new Date() })
    .where(
      and(
        eq(importRules.id, c.req.param('id')),
        eq(importRules.userId, userId),
        eq(importRules.status, 'denied'),
        isNull(importRules.deletedAt),
      ),
    )
    .returning()

  if (!updated) return fail(c, 'RULE_NOT_FOUND')
  return c.json(updated)
})

export default app
