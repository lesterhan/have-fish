import { and, count, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { accounts, postings, transactions } from '../db/schema'
import { fail } from '../errors'
import { amountLike, as, asField, parseBody } from '../validation'

const app = new Hono<{ Variables: AppVariables }>()

// PATCH /api/postings/:id
// Updates accountId, amount, and/or currency of a posting.
// Ownership verified via parent transaction.
const PostingPatch = z.object({
  accountId: z.uuid({ error: asField('FIELD_NOT_UUID') }).optional(),
  amount: amountLike.optional(),
  currency: z.string({ error: asField('FIELD_NOT_STRING') }).optional(),
})

app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const parsed = await parseBody(c, PostingPatch)
  if (!parsed.ok) return parsed.response

  const { accountId, amount, currency } = parsed.data
  if (!accountId && amount === undefined && !currency) {
    return fail(c, 'NO_FIELDS_TO_UPDATE')
  }

  if (accountId) {
    const [targetAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)),
      )
    if (!targetAccount) return fail(c, 'ACCOUNT_NOT_FOUND')
  }

  const [posting] = await db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(postings.id, id),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(postings.deletedAt),
      ),
    )

  if (!posting) return fail(c, 'POSTING_NOT_FOUND')

  const updates: { accountId?: string; amount?: string; currency?: string } = {}
  if (accountId) updates.accountId = accountId
  if (amount !== undefined) updates.amount = String(amount)
  if (currency) updates.currency = currency

  const [updated] = await db.update(postings).set(updates).where(eq(postings.id, id)).returning()

  return c.json(updated)
})

// POST /api/postings
// Creates a new posting on an existing transaction.
// Verifies the transaction belongs to the authenticated user.
// All four fields are required together, and the route has always said so as one failure
// naming all four rather than four failures naming one each — so every field carries that
// same code rather than the one the schema would have picked for it.
const required = as('FIELDS_REQUIRED', {
  fields: ['transactionId', 'accountId', 'amount', 'currency'],
})

const NewPosting = z.object({
  transactionId: z.uuid({ error: required }),
  accountId: z.uuid({ error: required }),
  amount: z.union([z.string(), z.number()], { error: required }),
  currency: z.string({ error: required }).min(1, { error: required }),
})

app.post('/', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, NewPosting)
  if (!parsed.ok) return parsed.response

  const { transactionId, accountId, amount, currency } = parsed.data

  const [tx] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    )

  if (!tx) return fail(c, 'TRANSACTION_NOT_FOUND')

  const [targetAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))

  if (!targetAccount) return fail(c, 'ACCOUNT_NOT_FOUND')

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
    .where(
      and(
        eq(postings.id, id),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(postings.deletedAt),
      ),
    )

  if (!posting) return fail(c, 'POSTING_NOT_FOUND')

  // An aggregate without GROUP BY always returns exactly one row.
  const { activeCount } = returnedRow(
    await db
      .select({ activeCount: count() })
      .from(postings)
      .where(and(eq(postings.transactionId, posting.transactionId), isNull(postings.deletedAt))),
    'select count(postings)',
  )

  if (activeCount <= 2) {
    return fail(c, 'TOO_FEW_POSTINGS')
  }

  const [deleted] = await db
    .update(postings)
    .set({ deletedAt: new Date() })
    .where(eq(postings.id, id))
    .returning()

  return c.json(deleted)
})

export default app
