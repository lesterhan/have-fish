import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { db } from '../db'
import { transactions, postings, csvParsers } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import { parseCsv, normalizeHeader } from '../import/csv-parser'
import { buildParser } from '../import/dynamic-parser'
import type { ParsedTransaction, ColumnMapping } from '../import/types'

const app = new Hono<{ Variables: AppVariables }>()

// POST /api/import/preview
// Parses an uploaded CSV using the user's saved parser that matches the file's
// column fingerprint. Returns what would be imported — no DB writes.
//
// Request: multipart/form-data
//   file            (File)   — the CSV file from the bank
//   accountId       (string) — UUID of the account this CSV belongs to
//   defaultCurrency (string) — fallback currency for rows that don't include one
//
// Response: { parser: string, transactions: ParsedTransaction[], errors: ParseError[] }
// Error 422: no saved parser matched this CSV's columns
app.post('/preview', async (c) => {
  const userId = c.get('userId')
  const form = await c.req.formData()
  const file = form.get('file')
  const accountId = form.get('accountId')
  const defaultCurrency = form.get('defaultCurrency')

  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400)
  if (!accountId || typeof accountId !== 'string') return c.json({ error: 'accountId is required' }, 400)
  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)

  const csv = await file.text()
  const rows = parseCsv(csv)

  if (rows.length === 0) return c.json({ error: 'CSV is empty or has no data rows' }, 422)

  // parseCsv already normalises headers, so Object.keys gives us the normalised column names.
  // normalizeHeader sorts and joins them into the fingerprint used for matching.
  const fingerprint = normalizeHeader(Object.keys(rows[0]))

  const userParsers = await db
    .select()
    .from(csvParsers)
    .where(and(eq(csvParsers.userId, userId), isNull(csvParsers.deletedAt)))

  const matched = userParsers.find((p) => p.normalizedHeader === fingerprint)

  if (!matched) {
    return c.json(
      { error: 'No saved parser matched this CSV. Create one in Settings → Import Parsers.' },
      422,
    )
  }

  const parse = buildParser(matched.columnMapping as ColumnMapping)
  const result = parse(rows)

  return c.json({ parser: matched.name, ...result })
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
