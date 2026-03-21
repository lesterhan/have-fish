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
//   defaultCurrency (string) — fallback currency for rows that don't include one
//
// Response: { parser: string, defaultAccountId: string|null, transactions: ParsedTransaction[], errors: ParseError[] }
// Error 422: no saved parser matched this CSV's columns
app.post('/preview', async (c) => {
  const userId = c.get('userId')
  const form = await c.req.formData()
  const file = form.get('file')
  const defaultCurrency = form.get('defaultCurrency')

  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400)
  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)

  const csv = await file.text()
  const rows = parseCsv(csv)

  if (rows.length === 0) return c.json({ error: 'CSV is empty or has no data rows' }, 422)

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

  return c.json({ parser: matched.name, defaultAccountId: matched.defaultAccountId, ...result })
})

// POST /api/import/commit
// Writes a set of pre-parsed transactions to the database.
// Each transaction becomes one transaction row and two posting rows:
//   - one posting for the source account (raw amount)
//   - one posting for the offset account (negated amount, balances to zero)
//
// Request body (JSON):
//   accountId       — UUID of the source account (the one the CSV belongs to)
//   defaultCurrency — fallback currency for transactions missing a currency field
//   transactions    — array of ParsedTransaction with an added offsetAccountId per row
//
// Each transaction carries its own offsetAccountId so different rows can be
// categorised to different accounts during the preview step.
//
// Response: { created: number }
app.post('/commit', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { accountId, defaultCurrency, transactions: parsed } = body

  if (!accountId || typeof accountId !== 'string') return c.json({ error: 'accountId is required' }, 400)
  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)
  if (!Array.isArray(parsed) || parsed.length === 0) return c.json({ error: 'transactions must be a non-empty array' }, 400)
  if (parsed.some((t: Record<string, unknown>) => !t.offsetAccountId || typeof t.offsetAccountId !== 'string')) {
    return c.json({ error: 'each transaction must include an offsetAccountId' }, 400)
  }

  type CommitTransaction = ParsedTransaction & { offsetAccountId: string }

  await db.transaction(async (tx) => {
    for (const t of parsed as CommitTransaction[]) {
      const currency = t.currency ?? defaultCurrency
      const negated = (-parseFloat(t.amount)).toFixed(2)

      const [newTx] = await tx
        .insert(transactions)
        .values({ userId, date: new Date(t.date), description: t.description })
        .returning()

      await tx.insert(postings).values([
        { transactionId: newTx.id, accountId, amount: t.amount, currency },
        { transactionId: newTx.id, accountId: t.offsetAccountId, amount: negated, currency },
      ])
    }
  })

  return c.json({ created: parsed.length }, 201)
})

export default app
