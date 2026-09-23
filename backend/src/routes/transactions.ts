import { and, desc, eq, gte, inArray, isNull, like, lte, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { accounts, expenseGroups, groupExpenses, postings, transactions } from '../db/schema'
import { fail, failWith } from '../errors'
import { loadClassifySettings } from '../postings/classify-service'
import { findMalformedFxSpends, healFxSpend, loadHealContext } from '../postings/heal-service'
import { classifyPostings, type PostingRole } from '../postings/roles'
import { amountLike, as, asField, parseBody } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

// Augments raw posting rows (from an insert .returning()) with accountPath + derived
// role so create/replace responses match the GET payload shape. This keeps a single
// honest `Posting` type on the client and lets a freshly-created row be narrated
// (TransactionDetail) without a refetch. Postings carry transactionId, so a flattened
// list from several transactions can be enriched in one pass and regrouped by caller.
async function enrichPostings<T extends { id: string; accountId: string }>(
  userId: string,
  rows: T[],
): Promise<(T & { accountPath: string; accountName: string | null; role: PostingRole })[]> {
  if (rows.length === 0) return []
  const accountIds = [...new Set(rows.map((r) => r.accountId))]
  const accountRows = await db
    .select({ id: accounts.id, path: accounts.path, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(inArray(accounts.id, accountIds), eq(accounts.userId, userId)))
  const byId = new Map(accountRows.map((a) => [a.id, a]))
  const withPath = rows.map((r) => ({
    ...r,
    accountPath: byId.get(r.accountId)?.path ?? '',
    accountName: byId.get(r.accountId)?.name ?? null,
  }))
  const settings = await loadClassifySettings(userId)
  // The classifier reads the account's stored type override; the shape this returns does not
  // carry it. On its own the override is a half-answer — null means "infer from the path",
  // which needs the user's configured roots — and `role` is the whole one. So the classifier
  // gets its own view of the same rows rather than a field stripped back off on the way out.
  const roleById = classifyPostings(
    withPath.map((r) => ({ ...r, accountType: byId.get(r.accountId)?.type ?? null })),
    settings,
  )
  return withPath.map((r) => ({ ...r, role: roleById.get(r.id)! }))
}

// True when every id is an active account owned by userId. Guards the create/replace
// paths so a transaction can't reference (or leak the path of) another user's account.
// Empty input is vacuously true; posting-count validation rejects empties separately.
async function accountsOwnedBy(userId: string, accountIds: string[]): Promise<boolean> {
  const unique = [...new Set(accountIds)]
  if (unique.length === 0) return true
  const owned = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(inArray(accounts.id, unique), eq(accounts.userId, userId), isNull(accounts.deletedAt)),
    )
  return owned.length === unique.length
}

// GET /api/transactions/malformed-fx-spend
// Lists transactions matching the malformed cross-currency-spend shape (expense account
// reused as the FX bridge + a phantom balance holding), each with a before/after preview
// of the one-click repair. canHeal is false when no conversion account is configured.
//
// Registered before any '/:id' route so the literal path isn't shadowed.
app.get('/malformed-fx-spend', async (c) => {
  const userId = c.get('userId')
  const ctx = await loadHealContext(userId)
  const candidates = await findMalformedFxSpends(userId, ctx)
  const canHeal = ctx.conversionAccountId !== null

  const result = candidates.map(({ transaction, postings: ps, finding }) => {
    // "After" mirrors the repair: both bridge legs → conversion account, phantom → expense.
    const after = ps.map((p) => {
      if (!canHeal) return p
      if (p.id === finding.sourceBridgePostingId || p.id === finding.targetBridgePostingId) {
        return {
          ...p,
          accountId: ctx.conversionAccountId!,
          accountPath: ctx.conversionAccountPath ?? p.accountPath,
        }
      }
      if (p.id === finding.phantomPostingId) {
        return {
          ...p,
          accountId: finding.expenseAccountId,
          accountPath: finding.expenseAccountPath,
        }
      }
      return p
    })
    return {
      transactionId: transaction.id,
      date: transaction.date,
      description: transaction.description,
      before: ps,
      after,
      canHeal,
    }
  })

  return c.json({ candidates: result, conversionAccountConfigured: canHeal })
})

// GET /api/transactions
// Returns all transactions for the user, each with its postings array embedded.
// Filter by account: ?accountId=... (exact account UUID match)
//                   ?accountPath=... (matches the account and all children by path prefix)
// Filter by date: ?from=YYYY-MM-DD and/or ?to=YYYY-MM-DD (both inclusive, both optional)
app.get('/', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.query('accountId')
  const accountPath = c.req.query('accountPath')

  const from = c.req.query('from')
  const to = c.req.query('to')

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (from && !dateRe.test(from)) return fail(c, 'FIELD_NOT_DATE', { field: 'from' })
  if (to && !dateRe.test(to)) return fail(c, 'FIELD_NOT_DATE', { field: 'to' })

  let txRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        from ? gte(transactions.date, new Date(from)) : undefined,
        to ? lte(transactions.date, new Date(`${to}T23:59:59.999Z`)) : undefined,
      ),
    )
    .orderBy(desc(transactions.date))

  if (accountId) {
    // Filter to transactions that have at least one posting for this account
    const postingRows = await db
      .select({ transactionId: postings.transactionId })
      .from(postings)
      .where(eq(postings.accountId, accountId))
    const txIds = [...new Set(postingRows.map((p) => p.transactionId))]
    if (txIds.length === 0) return c.json([])
    txRows = txRows.filter((tx) => txIds.includes(tx.id))
  }

  if (accountPath) {
    // Match the account itself and all children (e.g. "expenses:food" matches
    // "expenses:food" and "expenses:food:restaurant").
    // Escape LIKE special chars so user input can't broaden the match.
    const escaped = accountPath.replace(/[%_\\]/g, '\\$&')
    const matchingAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          isNull(accounts.deletedAt),
          or(eq(accounts.path, accountPath), like(accounts.path, `${escaped}:%`)),
        ),
      )
    const accountIds = matchingAccounts.map((a) => a.id)
    if (accountIds.length === 0) return c.json([])
    const postingRows = await db
      .select({ transactionId: postings.transactionId })
      .from(postings)
      .where(and(inArray(postings.accountId, accountIds), isNull(postings.deletedAt)))
    const txIds = [...new Set(postingRows.map((p) => p.transactionId))]
    if (txIds.length === 0) return c.json([])
    txRows = txRows.filter((tx) => txIds.includes(tx.id))
  }

  if (txRows.length === 0) return c.json([])

  // Fetch all postings for the matched transactions in one query, joined to their account
  // path so each leg can be classified and rendered without a second lookup.
  const txIds = txRows.map((tx) => tx.id)
  const postingRows = await db
    .select({
      id: postings.id,
      transactionId: postings.transactionId,
      accountId: postings.accountId,
      accountPath: accounts.path,
      accountName: accounts.name,
      // For the role classifier only; stripped before the rows go on the wire, for the
      // reason given in `enrichPostings`.
      accountType: accounts.type,
      amount: postings.amount,
      currency: postings.currency,
      createdAt: postings.createdAt,
      deletedAt: postings.deletedAt,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(inArray(postings.transactionId, txIds), isNull(postings.deletedAt)))
    .orderBy(postings.createdAt)

  // Derive each posting's role within its transaction (subject/transfer/conversion/fee/share)
  // so the read payload narrates a complex multi-leg transaction instead of dumping raw legs.
  const classifySettings = await loadClassifySettings(userId)
  const roleById = classifyPostings(postingRows, classifySettings)

  // Group postings by transactionId and embed into each transaction, with role attached
  type EmbeddedPosting = Omit<(typeof postingRows)[number], 'accountType'> & { role: PostingRole }
  const postingsByTx = postingRows.reduce<Record<string, EmbeddedPosting[]>>((acc, p) => {
    const forTx = acc[p.transactionId] ?? []
    const { accountType: _classifierInput, ...wire } = p
    forTx.push({ ...wire, role: roleById.get(p.id)! })
    acc[p.transactionId] = forTx
    return acc
  }, {})

  // Resolve the group a transaction belongs to via the single forward link
  // (transactions.groupExpenseId). This is total: member transactions and the payer's origin
  // import transaction are all stamped with it, so one lookup answers every row. (The reverse
  // pointer groupExpenses.transactionId still exists, but only marks the origin import line for
  // the edit/delete lifecycle — it is not a read path.)
  const groupExpenseIds = txRows
    .map((tx) => tx.groupExpenseId)
    .filter((id): id is string => id !== null)
  const groupNameByExpenseId: Record<string, string> = {}
  if (groupExpenseIds.length > 0) {
    const rows = await db
      .select({ expenseId: groupExpenses.id, groupName: expenseGroups.name })
      .from(groupExpenses)
      .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
      .where(inArray(groupExpenses.id, groupExpenseIds))
    for (const row of rows) {
      groupNameByExpenseId[row.expenseId] = row.groupName
    }
  }

  const result = txRows.map((tx) => ({
    ...tx,
    postings: postingsByTx[tx.id] ?? [],
    groupName: tx.groupExpenseId ? (groupNameByExpenseId[tx.groupExpenseId] ?? null) : null,
  }))
  return c.json(result)
})

// POST /api/transactions
// Creates a transaction and its postings atomically.
// Request body:
//   {
//     date: string (ISO),
//     description?: string,
//     postings: [{ accountId: string, amount: string, currency: string }, ...]
//   }
// Rules:
//   - At least two postings required
//   - Postings must balance to zero per currency (sum of amounts per currency = 0)
// A calendar day, the shape the `date` column stores. The PATCH route below has always
// checked this; the create routes reached the column with whatever arrived and let
// Postgres raise, so this is the same rule applied in all three places.
const isoDate = z
  .string({ error: asField('FIELD_NOT_DATE') })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: asField('FIELD_NOT_DATE') })

// One posting as a request carries it.
//
// `currency` is only checked for being a string here. Whether it is a currency this
// ledger supports is the handler's question below, because the answer carries the
// offending code and, in a bulk request, which transaction it came from — neither of
// which a per-field schema can see.
//
// `amount` arrives as a string from the web app and as a number from a few callers, and
// the numeric column takes either; normalising to a string here means the balance
// arithmetic downstream has one type to read rather than two.
const PostingInput = z.object({
  accountId: z.uuid({ error: asField('FIELD_NOT_UUID') }),
  amount: amountLike,
  currency: z.string({ error: asField('FIELD_NOT_STRING') }),
})

const tooFew = as('TOO_FEW_POSTINGS')

const NewTransaction = z.object({
  date: isoDate,
  description: z.string().nullish(),
  postings: z.array(PostingInput, { error: tooFew }).min(2, { error: tooFew }),
})

app.post('/', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, NewTransaction)
  if (!parsed.ok) return parsed.response
  const { date, description, postings: postingInputs } = parsed.data

  // Validate currency codes
  for (const p of postingInputs) {
    if (!isValidCurrency(p.currency)) {
      return fail(c, 'UNSUPPORTED_CURRENCY', { currency: p.currency })
    }
  }

  // Validate balance per currency: sum of amounts must equal zero
  const balances: Record<string, number> = {}
  for (const p of postingInputs) {
    balances[p.currency] = (balances[p.currency] ?? 0) + parseFloat(p.amount)
  }
  for (const [currency, sum] of Object.entries(balances)) {
    if (Math.abs(sum) > 0.001) {
      return fail(c, 'POSTINGS_DO_NOT_BALANCE', { currency, sum })
    }
  }

  // Verify every referenced account belongs to this user before inserting.
  const inputAccountIds = postingInputs.map((p) => p.accountId)
  if (!(await accountsOwnedBy(userId, inputAccountIds))) {
    return fail(c, 'ACCOUNTS_NOT_FOUND')
  }

  const created = await db.transaction(async (tx) => {
    const newTx = returnedRow(
      await tx
        .insert(transactions)
        .values({ userId, date: new Date(date), description: description ?? null })
        .returning(),
      'insert transactions',
    )

    const newPostings = await tx
      .insert(postings)
      .values(
        postingInputs.map((p) => ({
          transactionId: newTx.id,
          accountId: p.accountId,
          amount: p.amount,
          currency: p.currency,
        })),
      )
      .returning()

    return { ...newTx, postings: newPostings }
  })

  const enriched = await enrichPostings(userId, created.postings)
  return c.json({ ...created, postings: enriched }, 201)
})

// POST /api/transactions/bulk
// Creates multiple transactions atomically — all succeed or all fail.
// Request body: { transactions: Array<{ date, description?, postings }> }
// Same posting rules as POST /api/transactions apply to each entry.
// The per-entry `postings` array deliberately has no `.min(2)`: too few postings is
// reported with the index of the entry that is short, and the loop below is what knows it.
const emptyBatch = as('FIELD_EMPTY', { field: 'transactions' })

const BulkTransactions = z.object({
  transactions: z
    .array(
      z.object({
        date: isoDate,
        description: z.string().nullish(),
        postings: z.array(PostingInput, { error: tooFew }),
      }),
      { error: emptyBatch },
    )
    .min(1, { error: emptyBatch }),
})

app.post('/bulk', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, BulkTransactions)
  if (!parsed.ok) return parsed.response
  const { transactions: txInputs } = parsed.data

  // Validate each transaction before touching the DB
  for (const [i, entry] of txInputs.entries()) {
    const { postings: postingInputs } = entry
    if (postingInputs.length < 2) {
      return fail(c, 'TOO_FEW_POSTINGS', { index: i })
    }
    for (const p of postingInputs) {
      if (!isValidCurrency(p.currency)) {
        return fail(c, 'UNSUPPORTED_CURRENCY', { currency: p.currency, index: i })
      }
    }
    const balances: Record<string, number> = {}
    for (const p of postingInputs) {
      balances[p.currency] = (balances[p.currency] ?? 0) + parseFloat(p.amount)
    }
    for (const [currency, sum] of Object.entries(balances)) {
      if (Math.abs(sum) > 0.001) {
        return fail(c, 'POSTINGS_DO_NOT_BALANCE', { currency, index: i })
      }
    }
  }

  // Verify every referenced account (across all transactions) belongs to this user.
  const allAccountIds = txInputs.flatMap((t) => t.postings.map((p) => p.accountId))
  if (!(await accountsOwnedBy(userId, allAccountIds))) {
    return fail(c, 'ACCOUNTS_NOT_FOUND')
  }

  const created = await db.transaction(async (tx) => {
    const results = []
    for (const { date, description, postings: postingInputs } of txInputs) {
      const newTx = returnedRow(
        await tx
          .insert(transactions)
          .values({ userId, date: new Date(date), description: description ?? null })
          .returning(),
        'insert transactions',
      )
      const newPostings = await tx
        .insert(postings)
        .values(
          postingInputs.map((p) => ({
            transactionId: newTx.id,
            accountId: p.accountId,
            amount: p.amount,
            currency: p.currency,
          })),
        )
        .returning()
      results.push({ ...newTx, postings: newPostings })
    }
    return results
  })

  // Enrich every posting across all created transactions in one pass, then regroup.
  const enriched = await enrichPostings(
    userId,
    created.flatMap((t) => t.postings),
  )
  const byTx = new Map<string, typeof enriched>()
  for (const p of enriched) {
    const list = byTx.get(p.transactionId)
    if (list) list.push(p)
    else byTx.set(p.transactionId, [p])
  }
  return c.json(
    created.map((t) => ({ ...t, postings: byTx.get(t.id) ?? [] })),
    201,
  )
})

// PATCH /api/transactions/:id
// Partial update for description and/or date. Ignores unknown fields.
const TransactionPatch = z.object({
  description: z.string().nullish(),
  date: isoDate.optional(),
})

app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const parsed = await parseBody(c, TransactionPatch)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const updates: { description?: string | null; date?: Date } = {}
  if ('description' in body) updates.description = body.description ?? null
  if (body.date !== undefined) updates.date = new Date(body.date)

  if (Object.keys(updates).length === 0) {
    return fail(c, 'NO_FIELDS_TO_UPDATE')
  }

  const [updated] = await db
    .update(transactions)
    .set(updates)
    .where(
      and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
    )
    .returning()

  if (!updated) return fail(c, 'TRANSACTION_NOT_FOUND')
  return c.json(updated)
})

// POST /api/transactions/:id/postings
// Replaces all postings on a transaction atomically (used when editing a transaction).
// Request body:
//   { postings: [{ accountId: string, amount: string, currency: string }, ...] }
// Rules:
//   - At least two postings required
//   - Postings must balance to zero per currency
//   - Verifies the transaction belongs to the authenticated user
const ReplacePostings = z.object({
  postings: z.array(PostingInput, { error: tooFew }).min(2, { error: tooFew }),
})

app.post('/:id/postings', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const parsed = await parseBody(c, ReplacePostings)
  if (!parsed.ok) return parsed.response
  const { postings: postingInputs } = parsed.data

  // Validate currency codes
  for (const p of postingInputs) {
    if (!isValidCurrency(p.currency)) {
      return fail(c, 'UNSUPPORTED_CURRENCY', { currency: p.currency })
    }
  }

  // Validate balance per currency
  const balances: Record<string, number> = {}
  for (const p of postingInputs) {
    balances[p.currency] = (balances[p.currency] ?? 0) + parseFloat(p.amount)
  }
  for (const [currency, sum] of Object.entries(balances)) {
    if (Math.abs(sum) > 0.001) {
      return fail(c, 'POSTINGS_DO_NOT_BALANCE', { currency, sum })
    }
  }

  // Verify transaction exists and belongs to this user
  const [tx] = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
    )

  if (!tx) return fail(c, 'TRANSACTION_NOT_FOUND')

  // Verify all accounts exist and belong to this user
  const inputAccountIds = postingInputs.map((p) => p.accountId)
  if (!(await accountsOwnedBy(userId, inputAccountIds))) {
    return fail(c, 'ACCOUNTS_NOT_FOUND')
  }

  // Atomically replace all postings
  const result = await db.transaction(async (dbTx) => {
    await dbTx.delete(postings).where(eq(postings.transactionId, id))
    const newPostings = await dbTx
      .insert(postings)
      .values(
        postingInputs.map((p) => ({
          transactionId: id,
          accountId: p.accountId,
          amount: p.amount,
          currency: p.currency,
        })),
      )
      .returning()
    return { ...tx, postings: newPostings }
  })

  const enriched = await enrichPostings(userId, result.postings)
  return c.json({ ...result, postings: enriched })
})

// POST /api/transactions/:id/heal-fx-spend
// Repairs a malformed cross-currency-spend transaction in place: repoints the two FX-bridge
// legs to the conversion account and the phantom balance leg to the expense account. Amounts
// are untouched, so the entry stays balanced. Rejects transactions that aren't malformed
// (409) and requests when no conversion account is configured (400).
app.post('/:id/heal-fx-spend', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const ctx = await loadHealContext(userId)
  const result = await healFxSpend(userId, id, ctx)
  if (!result.ok) return failWith(c, result.failure)
  return c.json({ postings: result.postings })
})

// DELETE /api/transactions/:id
// Soft-deletes a transaction and hard-deletes its postings.
// The transaction row with deletedAt set is the audit record that it existed.
// Postings have no meaning without their transaction, so they don't need a tombstone.
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await db.transaction(async (tx) => {
    await tx.delete(postings).where(eq(postings.transactionId, id))
    await tx
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
        ),
      )
  })
  return c.body(null, 204)
})

export default app
