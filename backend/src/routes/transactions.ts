import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { isCalendarDate } from '../calendar-date'
import { enrichPostings, listTransactions } from '../ledger/read-service'
import {
  createTransaction,
  createTransactions,
  deleteTransaction,
  replacePostings,
  updateTransactionDetails,
} from '../ledger/write-service'
import { healFxSpend, malformedFxSpendReport } from '../postings/heal-service'
import { fail, failWith } from '../respond'
import { amountLike, as, asField, parseBody } from '../validation'

// The handlers parse the request and answer. Reads are `ledger/read-service`, writes
// `ledger/write-service`, and the FX-spend repair `postings/heal-service`.

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/transactions/malformed-fx-spend
// Lists transactions matching the malformed cross-currency-spend shape (expense account
// reused as the FX bridge + a phantom balance holding), each with a before/after preview
// of the one-click repair. canHeal is false when no conversion account is configured.
//
// Registered before any '/:id' route so the literal path isn't shadowed.
app.get('/malformed-fx-spend', async (c) => c.json(await malformedFxSpendReport(c.get('userId'))))

// GET /api/transactions
// Returns all transactions for the user, each with its postings array embedded.
// Filter by account: ?accountId=... (exact account UUID match)
//                   ?accountPath=... (matches the account and all children by path prefix)
// Filter by date: ?from=YYYY-MM-DD and/or ?to=YYYY-MM-DD (both inclusive, both optional)
// Filter to spending: ?spending=true keeps only transactions with a genuine spend leg, by the
//                   same definition the spending reports sum (spend-service.ts). With it,
//                   `accountPath` scopes the spend leg rather than any leg: the list beside a
//                   drilled-in category shows what that category's figure is made of.
app.get('/', async (c) => {
  const userId = c.get('userId')
  const accountId = c.req.query('accountId')
  const accountPath = c.req.query('accountPath')

  const from = c.req.query('from')
  const to = c.req.query('to')

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (from && !dateRe.test(from)) return fail(c, 'FIELD_NOT_DATE', { field: 'from' })
  if (to && !dateRe.test(to)) return fail(c, 'FIELD_NOT_DATE', { field: 'to' })

  const spendingParam = c.req.query('spending')
  if (spendingParam !== undefined && spendingParam !== 'true') {
    return fail(c, 'FIELD_NOT_BOOLEAN', { field: 'spending' })
  }
  const spending = spendingParam === 'true'

  return c.json(await listTransactions(userId, { accountId, accountPath, from, to, spending }))
})

// POST /api/transactions
// Creates a transaction and its postings atomically.
// Request body:
//   {
//     date: string (ISO),
//     description?: string,
//     postings: [{ accountId: string, amount: string, currency: string }, ...]
//   }
// The rules (two or more postings, supported currencies, balanced per currency) and the
// ownership check live in `ledger/`; this file parses the request and shapes the answer.
//
// A calendar day, the shape the `date` column stores. The PATCH route below has always
// checked this; the create routes reached the column with whatever arrived and let
// Postgres raise, so this is the same rule applied in all three places.
//
// A day that doesn't exist (`2026-02-30`) is refused too: the column is text since #277, so
// nothing downstream would catch it.
const isoDate = z
  .string({ error: asField('FIELD_NOT_DATE') })
  .refine(isCalendarDate, { error: asField('FIELD_NOT_DATE') })

// One posting as a request carries it.
//
// `currency` is only checked for being a string here. Whether it is a currency this
// ledger supports is `validatePostings`'s question, because the answer carries the
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

  const result = await createTransaction(userId, parsed.data)
  if (!result.ok) return failWith(c, result.failure)

  const created = result.value
  const enriched = await enrichPostings(userId, created.postings)
  return c.json({ ...created, postings: enriched }, 201)
})

// POST /api/transactions/bulk
// Creates multiple transactions atomically — all succeed or all fail.
// Request body: { transactions: Array<{ date, description?, postings }> }
// Same posting rules as POST /api/transactions apply to each entry.
// The per-entry `postings` array deliberately has no `.min(2)`: too few postings is
// reported with the index of the entry that is short, and `createTransactions` is what knows it.
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

  const result = await createTransactions(userId, parsed.data.transactions)
  if (!result.ok) return failWith(c, result.failure)
  const created = result.value

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

  const updates: { description?: string | null; date?: string } = {}
  if ('description' in body) updates.description = body.description ?? null
  if (body.date !== undefined) updates.date = body.date

  if (Object.keys(updates).length === 0) {
    return fail(c, 'NO_FIELDS_TO_UPDATE')
  }

  const result = await updateTransactionDetails(userId, id, updates)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// POST /api/transactions/:id/postings
// Replaces all postings on a transaction atomically (used when editing a transaction).
// Request body:
//   { postings: [{ accountId: string, amount: string, currency: string }, ...] }
// Same rules as create, and the transaction must be the caller's (404 otherwise).
const ReplacePostings = z.object({
  postings: z.array(PostingInput, { error: tooFew }).min(2, { error: tooFew }),
})

app.post('/:id/postings', async (c) => {
  const userId = c.get('userId')
  const parsed = await parseBody(c, ReplacePostings)
  if (!parsed.ok) return parsed.response

  const result = await replacePostings(userId, c.req.param('id'), parsed.data.postings)
  if (!result.ok) return failWith(c, result.failure)

  const replaced = result.value
  const enriched = await enrichPostings(userId, replaced.postings)
  return c.json({ ...replaced, postings: enriched })
})

// POST /api/transactions/:id/heal-fx-spend
// Repairs a malformed cross-currency-spend transaction in place: repoints the two FX-bridge
// legs to the conversion account and the phantom balance leg to the expense account. Amounts
// are untouched, so the entry stays balanced. Rejects transactions that aren't malformed
// (409) and requests when no conversion account is configured (400).
app.post('/:id/heal-fx-spend', async (c) => {
  const result = await healFxSpend(c.get('userId'), c.req.param('id'))
  if (!result.ok) return failWith(c, result.failure)
  return c.json({ postings: result.value })
})

// DELETE /api/transactions/:id
// Soft-deletes the transaction and hard-deletes its postings; `deleteTransaction` says why.
// The answer is 204 whether or not anything was deleted, like every other delete here:
// deleting what is already gone is not an error, and a 404 would say which ids exist for
// someone else.
app.delete('/:id', async (c) => {
  await deleteTransaction(c.get('userId'), c.req.param('id'))
  return c.body(null, 204)
})

export default app
