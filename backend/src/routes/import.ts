import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { db } from '../db'
import { transactions, postings, csvParsers, importRules } from '../db/schema'
import { eq, isNull, and, gte, lte } from 'drizzle-orm'
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

  // --- Duplicate detection ---
  // For each parsed transaction, check whether a posting already exists in the
  // database on the same account with a close-enough date (±1 day) and amount
  // (±0.01). We only run this when the parser has a defaultAccountId — without
  // one we can't know which account to look up historical postings for.

  type PossibleDuplicate = { transactionId: string; date: string; amount: string; currency: string } | null
  const duplicates: PossibleDuplicate[] = result.transactions.map(() => null)

  if (matched.defaultAccountId && result.transactions.length > 0) {
    // Compute the date window that spans all parsed rows (±1 day buffer).
    const parsedDates = result.transactions.map((t) => new Date(t.date))
    const minDate = new Date(Math.min(...parsedDates.map((d) => d.getTime())))
    const maxDate = new Date(Math.max(...parsedDates.map((d) => d.getTime())))
    minDate.setDate(minDate.getDate() - 1)
    maxDate.setDate(maxDate.getDate() + 1)
    // Extend to end-of-day so the lte bound is inclusive.
    maxDate.setHours(23, 59, 59, 999)

    // Fetch all postings for this account in the window.
    const existing = await db
      .select({
        transactionId: postings.transactionId,
        date: transactions.date,
        amount: postings.amount,
        currency: postings.currency,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(
          eq(postings.accountId, matched.defaultAccountId),
          isNull(postings.deletedAt),
          isNull(transactions.deletedAt),
          gte(transactions.date, minDate),
          lte(transactions.date, maxDate),
        ),
      )

    // Match each parsed transaction against the existing postings.
    for (let i = 0; i < result.transactions.length; i++) {
      const t = result.transactions[i]
      // Only regular rows have a single amount we can compare directly.
      // Transfer rows are more complex and skipped for now.
      if (t.isTransfer !== false) continue

      const txDate = new Date(t.date).getTime()
      const txAmount = parseFloat(t.amount)

      const match = existing.find((e) => {
        const eDate = new Date(e.date).getTime()
        const eAmount = parseFloat(e.amount)
        const dayMs = 24 * 60 * 60 * 1000
        return (
          Math.abs(eDate - txDate) <= dayMs &&
          Math.abs(eAmount - txAmount) <= 0.01
        )
      })

      if (match) {
        duplicates[i] = {
          transactionId: match.transactionId,
          date: match.date.toISOString().substring(0, 10),
          amount: match.amount,
          currency: match.currency,
        }
      }
    }
  }

  // Zip duplicates into the transactions array.
  const transactionsWithDuplicates = result.transactions.map((t, i) => ({
    ...t,
    possibleDuplicate: duplicates[i],
  }))

  // Apply active rules: for each regular (non-transfer) row, find the first rule
  // whose pattern is a case-insensitive substring of the description.
  const activeRules = await db
    .select({ pattern: importRules.pattern, accountId: importRules.accountId })
    .from(importRules)
    .where(and(eq(importRules.userId, userId), eq(importRules.status, 'active'), isNull(importRules.deletedAt)))

  const transactionsWithRules = transactionsWithDuplicates.map((t) => {
    if (t.isTransfer !== false || !t.description) return t
    const desc = t.description.toLowerCase()
    const match = activeRules.find((r) => desc.includes(r.pattern.toLowerCase()))
    if (!match) return t
    return { ...t, suggestedOffsetAccountId: match.accountId }
  })

  return c.json({
    parser: matched.name,
    defaultAccountId: matched.defaultAccountId,
    isMultiCurrency: matched.isMultiCurrency,
    defaultFeeAccountId: matched.defaultFeeAccountId,
    ...result,
    transactions: transactionsWithRules,
  })
})

// POST /api/import/commit
// Writes a set of pre-parsed transactions to the database.
//
// Regular rows produce 2 postings (source + offset). Transfer rows produce
// 4 postings (no fee) or 5 postings (with fee) using the equity:conversion
// account to bridge the two currencies — see inline comments.
//
// Request body (JSON):
//   accountId       — UUID of the source account for regular rows;
//                     may be empty string for multi-currency-only imports
//   defaultCurrency — fallback currency for regular rows missing a currency field
//   transactions    — array of CommitRow, one per parsed CSV row
//
// Regular row shape:   { isTransfer: false, date, amount, description?, currency?,
//                        offsetAccountId, sourceAccountId? }
// Transfer row shape:  { isTransfer: true, date, description?,
//                        sourceAmount, sourceCurrency, targetAmount, targetCurrency,
//                        feeAmount?, feeCurrency?,
//                        sourceAccountId, targetAccountId, conversionAccountId, feeAccountId }
//
// Response: { created: number }
app.post('/commit', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const { accountId, defaultCurrency, transactions: parsed } = body

  if (!defaultCurrency || typeof defaultCurrency !== 'string') return c.json({ error: 'defaultCurrency is required' }, 400)
  if (!Array.isArray(parsed) || parsed.length === 0) return c.json({ error: 'transactions must be a non-empty array' }, 400)

  // Per-row validation — requirements differ by row type
  for (const t of parsed as Record<string, unknown>[]) {
    if (t.isTransfer === true) {
      if (!t.sourceAccountId) return c.json({ error: 'transfer rows must include sourceAccountId' }, 400)
      if (!t.targetAccountId) return c.json({ error: 'transfer rows must include targetAccountId' }, 400)
      if (!t.conversionAccountId) return c.json({ error: 'transfer rows must include conversionAccountId' }, 400)
      if (!t.feeAccountId) return c.json({ error: 'transfer rows must include feeAccountId' }, 400)
    } else if (t.isTransfer === 'same-currency') {
      if (!t.targetAccountId) return c.json({ error: 'same-currency transfer rows must include targetAccountId' }, 400)
      if (!t.sourceAccountId) return c.json({ error: 'same-currency transfer rows must include sourceAccountId' }, 400)
      if (!t.feeAccountId) return c.json({ error: 'same-currency transfer rows must include feeAccountId' }, 400)
    } else {
      if (!t.offsetAccountId) return c.json({ error: 'regular rows must include offsetAccountId' }, 400)
      if (!t.sourceAccountId && !accountId) return c.json({ error: 'regular rows require sourceAccountId or a global accountId' }, 400)
    }
  }

  type RegularRow = {
    isTransfer: false
    date: string
    amount: string
    description?: string
    currency?: string
    offsetAccountId: string
    sourceAccountId?: string
  }

  type TransferRow = {
    isTransfer: true
    date: string
    description?: string
    sourceAmount: string   // negative (leaving source)
    sourceCurrency: string
    targetAmount: string   // positive (arriving at target)
    targetCurrency: string
    feeAmount?: string     // positive
    feeCurrency?: string
    sourceAccountId: string
    targetAccountId: string
    conversionAccountId: string
    feeAccountId: string
  }

  type SameCurrencyTransferRow = {
    isTransfer: 'same-currency'
    date: string
    description?: string
    amount: string    // net amount received (positive)
    feeAmount: string // fee charged (positive)
    currency: string
    targetAccountId: string   // the account that received the money
    sourceAccountId: string   // where the money came from
    feeAccountId: string
  }

  await db.transaction(async (tx) => {
    for (const t of parsed as (RegularRow | TransferRow | SameCurrencyTransferRow)[]) {
      const [newTx] = await tx
        .insert(transactions)
        .values({ userId, date: new Date(t.date), description: t.description })
        .returning()

      if (t.isTransfer === true) {
        // Cross-currency transfer — 4 or 5 postings depending on whether a fee is present.
        //
        // The equity:conversion account bridges the two currencies:
        //   1. source account loses sourceAmount in sourceCurrency  (e.g. −200.00 CAD)
        //   2. equity:conversion gains the amount minus fee         (e.g. +199.04 CAD)
        //   3. fee expense account gains feeAmount                  (e.g.   +0.96 CAD)  ← omitted if no fee
        //   4. equity:conversion loses targetAmount in targetCurrency (e.g. −107.90 GBP)
        //   5. target account gains targetAmount in targetCurrency  (e.g. +107.90 GBP)
        //
        // Per-currency totals balance to zero.

        const srcAmount = parseFloat(t.sourceAmount)  // negative
        const feeVal = t.feeAmount ? parseFloat(t.feeAmount) : 0  // positive or 0
        const tgtAmount = parseFloat(t.targetAmount)  // positive
        const feeCurrency = t.feeCurrency ?? t.sourceCurrency

        // conversion in source currency offsets source minus fee
        const conversionSrcAmount = (-(srcAmount + feeVal)).toFixed(2)

        type PostingRow = { transactionId: string; accountId: string; amount: string; currency: string }
        const postingRows: PostingRow[] = [
          { transactionId: newTx.id, accountId: t.sourceAccountId,     amount: t.sourceAmount,              currency: t.sourceCurrency },
          { transactionId: newTx.id, accountId: t.conversionAccountId, amount: conversionSrcAmount,          currency: t.sourceCurrency },
          { transactionId: newTx.id, accountId: t.conversionAccountId, amount: (-tgtAmount).toFixed(2),      currency: t.targetCurrency },
          { transactionId: newTx.id, accountId: t.targetAccountId,     amount: t.targetAmount,               currency: t.targetCurrency },
        ]

        if (t.feeAmount && feeVal !== 0) {
          // Insert fee posting at index 2 to follow the natural ledger order
          postingRows.splice(2, 0, {
            transactionId: newTx.id,
            accountId: t.feeAccountId,
            amount: t.feeAmount,
            currency: feeCurrency,
          })
        }

        await tx.insert(postings).values(postingRows)
      } else if (t.isTransfer === 'same-currency') {
        // Same-currency IN transfer — 3 postings:
        //   1. target account receives net amount (positive)
        //   2. fee expense account records the fee (positive)
        //   3. source account loses the gross amount (negative)
        const gross = (parseFloat(t.amount) + parseFloat(t.feeAmount)).toFixed(2)
        await tx.insert(postings).values([
          { transactionId: newTx.id, accountId: t.targetAccountId, amount: t.amount,         currency: t.currency },
          { transactionId: newTx.id, accountId: t.feeAccountId,    amount: t.feeAmount,       currency: t.currency },
          { transactionId: newTx.id, accountId: t.sourceAccountId, amount: `-${gross}`,       currency: t.currency },
        ])
      } else {
        // Regular 2-posting transaction
        const currency = t.currency ?? defaultCurrency
        const sourceId = t.sourceAccountId ?? accountId
        const negated = (-parseFloat(t.amount)).toFixed(2)

        await tx.insert(postings).values([
          { transactionId: newTx.id, accountId: sourceId, amount: t.amount, currency },
          { transactionId: newTx.id, accountId: t.offsetAccountId, amount: negated, currency },
        ])
      }
    }
  })

  return c.json({ created: parsed.length }, 201)
})

export default app
