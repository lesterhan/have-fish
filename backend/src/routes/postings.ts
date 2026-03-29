import { Hono } from 'hono'
import { db } from '../db'
import { accounts, postings, transactions } from '../db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// PATCH /api/postings/:id
// Updates the accountId of a posting.
// Validates that the target account exists and belongs to the user.
// Ownership of the posting is verified via its parent transaction.
app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await c.req.json()

  const { accountId } = body
  if (!accountId) return c.json({ error: 'accountId is required' }, 400)

  // Verify the target account exists and belongs to the user
  const [targetAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))

  if (!targetAccount) return c.json({ error: 'Account not found' }, 404)

  // Verify the posting exists and belongs to a transaction owned by this user
  const [posting] = await db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(eq(postings.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))

  if (!posting) return c.json({ error: 'Posting not found' }, 404)

  const [updated] = await db
    .update(postings)
    .set({ accountId })
    .where(eq(postings.id, id))
    .returning()

  return c.json(updated)
})

export default app
