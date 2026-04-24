import { Hono } from 'hono'
import { db } from '../db'
import { importRules, accounts, transactions, postings, userSettings } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/rules
// Returns all non-deleted rules (active + suggested) for the current user.
// Joins accounts to include accountPath for display.
app.get('/', async (c) => {
  const userId = c.get('userId')

  // TODO: join accounts to include accountPath and accountName
  const rules = await db
    .select({
      id: importRules.id,
      pattern: importRules.pattern,
      accountId: importRules.accountId,
      accountPath: accounts.path,
      accountName: accounts.name,
      status: importRules.status,
      matchCount: importRules.matchCount,
      createdAt: importRules.createdAt,
      updatedAt: importRules.updatedAt,
    })
    .from(importRules)
    .innerJoin(accounts, eq(importRules.accountId, accounts.id))
    .where(and(eq(importRules.userId, userId), isNull(importRules.deletedAt)))

  return c.json(rules)
})

// POST /api/rules
// Creates a rule manually. status defaults to 'active'.
// Body: { pattern: string, accountId: string }
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { pattern, accountId } = body

  if (!pattern || typeof pattern !== 'string') return c.json({ error: 'pattern is required' }, 400)
  if (!accountId || typeof accountId !== 'string') return c.json({ error: 'accountId is required' }, 400)

  const [created] = await db
    .insert(importRules)
    .values({ userId, pattern, accountId, status: 'active' })
    .returning()

  return c.json(created, 201)
})

// POST /api/rules/mine
// Analyzes transaction history and writes new 'suggested' rules.
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
    .innerJoin(postings, and(eq(postings.transactionId, transactions.id), isNull(postings.deletedAt)))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))

  // Group postings by transaction id
  const byTx = new Map<string, { description: string | null; postings: { accountId: string; accountPath: string }[] }>()
  for (const row of rows) {
    if (!byTx.has(row.txId)) byTx.set(row.txId, { description: row.description, postings: [] })
    byTx.get(row.txId)!.postings.push({ accountId: row.accountId, accountPath: row.accountPath })
  }

  // Count (description, expenseAccountId) pairs from 2-posting transactions
  const pairCounts = new Map<string, { description: string; accountId: string; count: number }>()
  for (const { description, postings: txPostings } of byTx.values()) {
    if (!description || txPostings.length !== 2) continue
    const expensePosting = txPostings.find((p) => p.accountPath.startsWith(`${expensesRoot}:`))
    if (!expensePosting) continue
    const key = `${description.toLowerCase()}|||${expensePosting.accountId}`
    const existing = pairCounts.get(key)
    if (existing) existing.count++
    else pairCounts.set(key, { description, accountId: expensePosting.accountId, count: 1 })
  }

  // For each unique description, keep the pair with the highest count
  const bestByDescription = new Map<string, { description: string; accountId: string; count: number }>()
  for (const pair of pairCounts.values()) {
    const descKey = pair.description.toLowerCase()
    const current = bestByDescription.get(descKey)
    if (!current || pair.count > current.count) bestByDescription.set(descKey, pair)
  }

  // Fetch existing non-deleted rules to skip already-covered descriptions
  const existingRules = await db
    .select({ pattern: importRules.pattern })
    .from(importRules)
    .where(and(eq(importRules.userId, userId), isNull(importRules.deletedAt)))
  const coveredPatterns = new Set(existingRules.map((r) => r.pattern.toLowerCase()))

  // Insert suggestions for uncovered descriptions
  const toInsert = [...bestByDescription.values()].filter(
    (pair) => !coveredPatterns.has(pair.description.toLowerCase()),
  )

  if (toInsert.length > 0) {
    await db.insert(importRules).values(
      toInsert.map((pair) => ({
        userId,
        pattern: pair.description,
        accountId: pair.accountId,
        status: 'suggested' as const,
        matchCount: pair.count,
      })),
    )
  }

  return c.json({ created: toInsert.length })
})

// PATCH /api/rules/:id
// Updates pattern and/or accountId. At least one field required.
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const patch: Record<string, unknown> = {}

  if ('pattern' in body) {
    if (!body.pattern || typeof body.pattern !== 'string') return c.json({ error: 'pattern must be a non-empty string' }, 400)
    patch.pattern = body.pattern
  }

  if ('accountId' in body) {
    if (!body.accountId || typeof body.accountId !== 'string') return c.json({ error: 'accountId must be a UUID string' }, 400)
    patch.accountId = body.accountId
  }

  if (Object.keys(patch).length === 0) return c.json({ error: 'at least one field is required' }, 400)

  patch.updatedAt = new Date()

  const [updated] = await db
    .update(importRules)
    .set(patch)
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
    .returning()

  if (!updated) return c.json({ error: 'rule not found' }, 404)
  return c.json(updated)
})

// DELETE /api/rules/:id
// Soft-deletes a rule.
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  await db
    .update(importRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
  return c.body(null, 204)
})

// POST /api/rules/:id/approve
// Flips a suggested rule to active.
app.post('/:id/approve', async (c) => {
  const userId = c.get('userId')

  const [updated] = await db
    .update(importRules)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
    .returning()

  if (!updated) return c.json({ error: 'rule not found' }, 404)
  return c.json(updated)
})

// POST /api/rules/:id/deny
// Soft-deletes a suggested rule (semantically distinct from DELETE).
app.post('/:id/deny', async (c) => {
  const userId = c.get('userId')
  await db
    .update(importRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(importRules.id, c.req.param('id')), eq(importRules.userId, userId), isNull(importRules.deletedAt)))
  return c.body(null, 204)
})

export default app
