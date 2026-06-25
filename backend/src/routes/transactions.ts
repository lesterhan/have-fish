import { Hono } from 'hono'
import { db } from '../db'
import { transactions, postings, groupExpenses, expenseGroups } from '../db/schema'
import { eq, isNull, and, inArray, gte, lte, or, like, desc } from 'drizzle-orm'
import { accounts } from '../db/schema'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { loadHealContext, findMalformedFxSpends, healFxSpend } from '../postings/heal-service'
import { loadClassifySettings } from '../postings/classify-service'
import { classifyPostings, type PostingRole } from '../postings/roles'

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
    .select({ id: accounts.id, path: accounts.path, name: accounts.name })
    .from(accounts)
    .where(and(inArray(accounts.id, accountIds), eq(accounts.userId, userId)))
  const byId = new Map(accountRows.map((a) => [a.id, a]))
  const withPath = rows.map((r) => ({
    ...r,
    accountPath: byId.get(r.accountId)?.path ?? '',
    accountName: byId.get(r.accountId)?.name ?? null,
  }))
  const settings = await loadClassifySettings(userId)
  const roleById = classifyPostings(withPath, settings)
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
    .where(and(inArray(accounts.id, unique), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
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
        return { ...p, accountId: ctx.conversionAccountId!, accountPath: ctx.conversionAccountPath ?? p.accountPath }
      }
      if (p.id === finding.phantomPostingId) {
        return { ...p, accountId: finding.expenseAccountId, accountPath: finding.expenseAccountPath }
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
  if (from && !dateRe.test(from)) return c.json({ error: 'Invalid from date, expected YYYY-MM-DD' }, 400)
  if (to && !dateRe.test(to)) return c.json({ error: 'Invalid to date, expected YYYY-MM-DD' }, 400)

  let txRows = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      from ? gte(transactions.date, new Date(from)) : undefined,
      to ? lte(transactions.date, new Date(`${to}T23:59:59.999Z`)) : undefined,
    ))
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
      .where(and(
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
        or(
          eq(accounts.path, accountPath),
          like(accounts.path, `${escaped}:%`),
        ),
      ))
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
  type EmbeddedPosting = (typeof postingRows)[number] & { role: PostingRole }
  const postingsByTx = postingRows.reduce<Record<string, EmbeddedPosting[]>>((acc, p) => {
    ; (acc[p.transactionId] ??= []).push({ ...p, role: roleById.get(p.id)! })
    return acc
  }, {})

  // Resolve the group expense a transaction belongs to. Two link directions exist:
  //   - member transactions point forward via transactions.groupExpenseId
  //   - the payer's import-linked transaction is pointed *to* by groupExpenses.transactionId
  //     (its own groupExpenseId stays null). Without resolving this reverse link, a split
  //     expense the user logged from import would surface with no groupExpenseId/groupName.
  const forwardExpenseIds = txRows
    .map((tx) => tx.groupExpenseId)
    .filter((id): id is string => id !== null)
  const groupNameByExpenseId: Record<string, string> = {}
  if (forwardExpenseIds.length > 0) {
    const rows = await db
      .select({ expenseId: groupExpenses.id, groupName: expenseGroups.name })
      .from(groupExpenses)
      .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
      .where(inArray(groupExpenses.id, forwardExpenseIds))
    for (const row of rows) {
      groupNameByExpenseId[row.expenseId] = row.groupName
    }
  }

  // Reverse link: active group expenses whose import transaction is in this result set.
  const reverseByTxId: Record<string, { expenseId: string; groupName: string }> = {}
  const reverseRows = await db
    .select({ txId: groupExpenses.transactionId, expenseId: groupExpenses.id, groupName: expenseGroups.name })
    .from(groupExpenses)
    .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
    .where(and(inArray(groupExpenses.transactionId, txIds), isNull(groupExpenses.deletedAt)))
  for (const row of reverseRows) {
    if (row.txId) reverseByTxId[row.txId] = { expenseId: row.expenseId, groupName: row.groupName }
  }

  const result = txRows.map((tx) => {
    const reverse = reverseByTxId[tx.id]
    const groupExpenseId = tx.groupExpenseId ?? reverse?.expenseId ?? null
    const groupName = tx.groupExpenseId
      ? (groupNameByExpenseId[tx.groupExpenseId] ?? null)
      : (reverse?.groupName ?? null)
    return { ...tx, groupExpenseId, postings: postingsByTx[tx.id] ?? [], groupName }
  })
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
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { date, description, postings: postingInputs } = body

  if (!Array.isArray(postingInputs) || postingInputs.length < 2) {
    return c.json({ error: 'At least two postings are required' }, 400)
  }

  // Validate currency codes
  for (const p of postingInputs) {
    if (!isValidCurrency(p.currency)) {
      return c.json({ error: `Unsupported currency: ${p.currency}` }, 400)
    }
  }

  // Validate balance per currency: sum of amounts must equal zero
  const balances: Record<string, number> = {}
  for (const p of postingInputs) {
    balances[p.currency] = (balances[p.currency] ?? 0) + parseFloat(p.amount)
  }
  for (const [currency, sum] of Object.entries(balances)) {
    if (Math.abs(sum) > 0.001) {
      return c.json({ error: `Postings do not balance for currency ${currency}: sum is ${sum}` }, 400)
    }
  }

  // Verify every referenced account belongs to this user before inserting.
  const inputAccountIds = postingInputs.map((p: { accountId: string }) => p.accountId)
  if (!(await accountsOwnedBy(userId, inputAccountIds))) {
    return c.json({ error: 'One or more accounts not found' }, 404)
  }

  const created = await db.transaction(async (tx) => {
    const [newTx] = await tx
      .insert(transactions)
      .values({ userId, date: new Date(date), description })
      .returning()

    const newPostings = await tx
      .insert(postings)
      .values(postingInputs.map((p: { accountId: string; amount: string; currency: string }) => ({
        transactionId: newTx.id,
        accountId: p.accountId,
        amount: p.amount,
        currency: p.currency,
      })))
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
app.post('/bulk', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { transactions: txInputs } = body

  if (!Array.isArray(txInputs) || txInputs.length === 0) {
    return c.json({ error: 'transactions array is required and must be non-empty' }, 400)
  }

  // Validate each transaction before touching the DB
  for (let i = 0; i < txInputs.length; i++) {
    const { postings: postingInputs } = txInputs[i]
    if (!Array.isArray(postingInputs) || postingInputs.length < 2) {
      return c.json({ error: `Transaction at index ${i}: at least two postings are required` }, 400)
    }
    for (const p of postingInputs) {
      if (!isValidCurrency(p.currency)) {
        return c.json({ error: `Transaction at index ${i}: unsupported currency ${p.currency}` }, 400)
      }
    }
    const balances: Record<string, number> = {}
    for (const p of postingInputs) {
      balances[p.currency] = (balances[p.currency] ?? 0) + parseFloat(p.amount)
    }
    for (const [currency, sum] of Object.entries(balances)) {
      if (Math.abs(sum) > 0.001) {
        return c.json({ error: `Transaction at index ${i}: postings do not balance for currency ${currency}` }, 400)
      }
    }
  }

  // Verify every referenced account (across all transactions) belongs to this user.
  const allAccountIds = txInputs.flatMap((t: { postings: { accountId: string }[] }) =>
    t.postings.map((p) => p.accountId),
  )
  if (!(await accountsOwnedBy(userId, allAccountIds))) {
    return c.json({ error: 'One or more accounts not found' }, 404)
  }

  const created = await db.transaction(async (tx) => {
    const results = []
    for (const { date, description, postings: postingInputs } of txInputs) {
      const [newTx] = await tx
        .insert(transactions)
        .values({ userId, date: new Date(date), description })
        .returning()
      const newPostings = await tx
        .insert(postings)
        .values(postingInputs.map((p: { accountId: string; amount: string; currency: string }) => ({
          transactionId: newTx.id,
          accountId: p.accountId,
          amount: p.amount,
          currency: p.currency,
        })))
        .returning()
      results.push({ ...newTx, postings: newPostings })
    }
    return results
  })

  // Enrich every posting across all created transactions in one pass, then regroup.
  const enriched = await enrichPostings(userId, created.flatMap((t) => t.postings))
  const byTx = new Map<string, typeof enriched>()
  for (const p of enriched) {
    const list = byTx.get(p.transactionId)
    if (list) list.push(p)
    else byTx.set(p.transactionId, [p])
  }
  return c.json(created.map((t) => ({ ...t, postings: byTx.get(t.id) ?? [] })), 201)
})

// PATCH /api/transactions/:id
// Partial update for description and/or date. Ignores unknown fields.
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json()

  const updates: { description?: string | null; date?: Date } = {}
  if ('description' in body) updates.description = body.description ?? null
  if ('date' in body) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return c.json({ error: 'Invalid date format, expected YYYY-MM-DD' }, 400)
    }
    updates.date = new Date(body.date)
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No updatable fields provided' }, 400)
  }

  const [updated] = await db
    .update(transactions)
    .set(updates)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .returning()

  if (!updated) return c.json({ error: 'Transaction not found' }, 404)
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
app.post('/:id/postings', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json()
  const { postings: postingInputs } = body

  // Validate inputs
  if (!Array.isArray(postingInputs) || postingInputs.length < 2) {
    return c.json({ error: 'At least two postings are required' }, 400)
  }

  // Validate currency codes
  for (const p of postingInputs) {
    if (!isValidCurrency(p.currency)) {
      return c.json({ error: `Unsupported currency: ${p.currency}` }, 400)
    }
  }

  // Validate balance per currency
  const balances: Record<string, number> = {}
  for (const p of postingInputs) {
    balances[p.currency] = (balances[p.currency] ?? 0) + parseFloat(p.amount)
  }
  for (const [currency, sum] of Object.entries(balances)) {
    if (Math.abs(sum) > 0.001) {
      return c.json({ error: `Postings do not balance for currency ${currency}: sum is ${sum}` }, 400)
    }
  }

  // Verify transaction exists and belongs to this user
  const [tx] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))

  if (!tx) return c.json({ error: 'Transaction not found' }, 404)

  // Verify all accounts exist and belong to this user
  const inputAccountIds = postingInputs.map((p: { accountId: string }) => p.accountId)
  if (!(await accountsOwnedBy(userId, inputAccountIds))) {
    return c.json({ error: 'One or more accounts not found' }, 404)
  }

  // Atomically replace all postings
  const result = await db.transaction(async (dbTx) => {
    await dbTx.delete(postings).where(eq(postings.transactionId, id))
    const newPostings = await dbTx
      .insert(postings)
      .values(postingInputs.map((p: { accountId: string; amount: string; currency: string }) => ({
        transactionId: id,
        accountId: p.accountId,
        amount: p.amount,
        currency: p.currency,
      })))
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
  if (!result.ok) return c.json({ error: result.error }, result.status)
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
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
  })
  return c.body(null, 204)
})

export default app
