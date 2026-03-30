import { Hono } from 'hono'
import { db } from '../db'
import { accounts, postings, transactions } from '../db/schema'
import { and, count, eq, isNull } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// PATCH /api/postings/:id
// Updates accountId, amount, and/or currency of a posting.
// Ownership verified via parent transaction.
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json()

  const { accountId, amount, currency } = body
  if (!accountId && amount === undefined && !currency) {
    return c.json({ error: 'At least one of accountId, amount, or currency is required' }, 400)
  }

  if (accountId) {
    const [targetAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    if (!targetAccount) return c.json({ error: 'Account not found' }, 404)
  }

  const [posting] = await db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(eq(postings.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt), isNull(postings.deletedAt)))

  if (!posting) return c.json({ error: 'Posting not found' }, 404)

  const updates: { accountId?: string; amount?: string; currency?: string } = {}
  if (accountId) updates.accountId = accountId
  if (amount !== undefined) updates.amount = String(amount)
  if (currency) updates.currency = currency

  const [updated] = await db
    .update(postings)
    .set(updates)
    .where(eq(postings.id, id))
    .returning()

  return c.json(updated)
})

// POST /api/postings
// Creates a new posting on an existing transaction.
// Verifies the transaction belongs to the authenticated user.
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()

  const { transactionId, accountId, amount, currency } = body
  if (!transactionId || !accountId || amount === undefined || !currency) {
    return c.json({ error: 'transactionId, accountId, amount, and currency are required' }, 400)
  }

  const [tx] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId), isNull(transactions.deletedAt)))

  if (!tx) return c.json({ error: 'Transaction not found' }, 404)

  const [targetAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))

  if (!targetAccount) return c.json({ error: 'Account not found' }, 404)

  const [created] = await db
    .insert(postings)
    .values({ transactionId, accountId, amount: String(amount), currency })
    .returning()

  return c.json(created, 201)
})

// DELETE /api/postings/:id
// Soft-deletes a posting. Rejects if the transaction would be left with fewer than 2 active postings.
app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const [posting] = await db
    .select({ id: postings.id, transactionId: postings.transactionId })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(eq(postings.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt), isNull(postings.deletedAt)))

  if (!posting) return c.json({ error: 'Posting not found' }, 404)

  const [{ activeCount }] = await db
    .select({ activeCount: count() })
    .from(postings)
    .where(and(eq(postings.transactionId, posting.transactionId), isNull(postings.deletedAt)))

  if (activeCount <= 2) {
    return c.json({ error: 'A transaction must have at least 2 postings' }, 400)
  }

  const [deleted] = await db
    .update(postings)
    .set({ deletedAt: new Date() })
    .where(eq(postings.id, id))
    .returning()

  return c.json(deleted)
})

export default app
