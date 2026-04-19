import { Hono } from 'hono'
import { db } from '../db'
import { transactions, postings } from '../db/schema'
import { eq, isNull, and, inArray, gte, lte, or, like } from 'drizzle-orm'
import { accounts } from '../db/schema'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'

const app = new Hono<{ Variables: AppVariables }>()

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

  // Fetch all postings for the matched transactions in one query
  const txIds = txRows.map((tx) => tx.id)
  const postingRows = await db
    .select()
    .from(postings)
    .where(and(inArray(postings.transactionId, txIds), isNull(postings.deletedAt)))
    .orderBy(postings.createdAt)

  // Group postings by transactionId and embed into each transaction
  const postingsByTx = postingRows.reduce<Record<string, typeof postingRows>>((acc, p) => {
    ; (acc[p.transactionId] ??= []).push(p)
    return acc
  }, {})

  const result = txRows.map((tx) => ({ ...tx, postings: postingsByTx[tx.id] ?? [] }))
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

  return c.json(created, 201)
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

  return c.json(created, 201)
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
  const inputAccountIds = [...new Set(postingInputs.map((p: { accountId: string }) => p.accountId))]
  const validAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(inArray(accounts.id, inputAccountIds), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (validAccounts.length !== inputAccountIds.length) {
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

  return c.json(result)
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
