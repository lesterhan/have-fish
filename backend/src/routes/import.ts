import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { transactionsFromCsv } from '../import/csv-parser'

const app = new Hono<{ Variables: AppVariables }>()

// POST /api/import/preview
// Parses an uploaded CSV and returns what would be imported — no DB writes.
//
// Request: multipart/form-data
//   file            (File)   — the CSV file from the bank
//   accountId       (string) — UUID of the account this CSV belongs to
//   defaultCurrency (string) — fallback currency for rows that don't include one (e.g. "CAD")
//
// Response: { transactions: ParsedTransaction[], errors: ParseError[] }
//
app.post('/preview', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file')
  const accountId = form.get('accountId')
  const defaultCurrency = form.get('defaultCurrency')

  if (!file || typeof file === 'string') return c.json({ error: 'file is required' }, 400)
  if (!accountId || typeof accountId !== 'string') return c.json({ error: 'accountId is required' }, 400)
  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)

  const csv = await file.text()
  const result = transactionsFromCsv(csv)
  return c.json(result)
})

export default app
