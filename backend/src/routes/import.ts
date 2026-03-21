import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { db } from '../db'
import { transactions, postings } from '../db/schema'

// TODO (task 4): move this to a shared types file once the dynamic parser is built
type ParsedTransaction = {
  date: string
  amount: string
  description?: string
  currency?: string
}

const app = new Hono<{ Variables: AppVariables }>()

// POST /api/import/preview
// TODO (task 4): load user's saved parsers, auto-detect by normalizedHeader, parse rows
app.post('/preview', async (c) => {
  return c.json({ error: 'Not implemented — awaiting dynamic parser (task 4)' }, 501)
})

// POST /api/import/commit
// Writes a set of pre-parsed transactions to the database.
// Each ParsedTransaction becomes one transaction row and two posting rows:
//   - one posting for the source account (raw amount)
//   - one posting for the offset account (negated amount, balances to zero)
//
// Request body (JSON):
//   accountId       — UUID of the source account (the one the CSV belongs to)
//   offsetAccountId — UUID of the account to balance against (e.g. expenses:uncategorized)
//   defaultCurrency — fallback currency for transactions missing a currency field
//   transactions    — array of ParsedTransaction (as returned by /preview)
//
// Response: { created: number }
app.post('/commit', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { accountId, offsetAccountId, defaultCurrency, transactions: parsed } = body

  if (!accountId || typeof accountId !== 'string') return c.json({ error: 'accountId is required' }, 400)
  if (!offsetAccountId || typeof offsetAccountId !== 'string') return c.json({ error: 'offsetAccountId is required' }, 400)
  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)
  if (!Array.isArray(parsed) || parsed.length === 0) return c.json({ error: 'transactions must be a non-empty array' }, 400)

  await db.transaction(async (tx) => {
    for (const t of parsed as ParsedTransaction[]) {
      const currency = t.currency ?? defaultCurrency
      const negated = (-parseFloat(t.amount)).toFixed(2)

      const [newTx] = await tx
        .insert(transactions)
        .values({ userId, date: new Date(t.date), description: t.description })
        .returning()

      await tx.insert(postings).values([
        { transactionId: newTx.id, accountId, amount: t.amount, currency },
        { transactionId: newTx.id, accountId: offsetAccountId, amount: negated, currency },
      ])
    }
  })

  return c.json({ created: parsed.length }, 201)
})

export default app
