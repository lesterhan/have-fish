import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { db } from '../db'
import { fxRates } from '../db/schema'
import { fail } from '../errors'
import * as money from '../money'
import { loadClassifySettings } from '../postings/classify-service'
import { hasExpenseAccountUnder, spendRows } from '../postings/spend-service'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/reports/spending-summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&prefix=expenses:food]
//
// Returns total spend and per-category breakdown for expense accounts only.
// Amounts are per currency (no conversion).
//
// Without prefix: categories are the first two path segments (e.g. "expenses:food").
// With prefix: filters to accounts under that prefix and groups one level deeper
// (e.g. prefix=expenses:food yields "expenses:food:restaurant", "expenses:food:groceries").
// A prefix that reaches no expense account is a caller mistake and answers 400. It need not
// sit under the configured expenses root: a tagged category at an atypical root is drillable
// like any other, and the resolved type is what decides.
//
// Each category includes childCount — the number of distinct direct child categories
// that have spending in the period. childCount > 0 means the category is drillable.
app.get('/spending-summary', async (c) => {
  const userId = c.get('userId')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const prefix = c.req.query('prefix') || null

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (from && !dateRe.test(from)) return fail(c, 'FIELD_NOT_DATE', { field: 'from' })
  if (to && !dateRe.test(to)) return fail(c, 'FIELD_NOT_DATE', { field: 'to' })

  const settings = await loadClassifySettings(userId)
  if (prefix && !(await hasExpenseAccountUnder(userId, settings, prefix))) {
    return fail(c, 'PREFIX_OUTSIDE_EXPENSES')
  }

  const rows = await spendRows(userId, settings, {
    ...(prefix === null ? {} : { prefix }),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  })

  const totalByCurrency: Record<string, number> = {}
  const categoryMap: Record<string, Record<string, number>> = {}
  // Tracks distinct direct-child category paths per category, used to compute childCount
  const directChildSets: Record<string, Set<string>> = {}

  const prefixDepth = prefix ? prefix.split(':').length : 0

  for (const row of rows) {
    const amount = money.cents(row.amount)
    const { currency } = row
    const segments = row.path.split(':')

    // Determine the category bucket this row falls into
    const category = prefix
      ? segments.slice(0, prefixDepth + 1).join(':') // one level deeper than prefix
      : segments.length >= 2
        ? `${segments[0]}:${segments[1]}`
        : // A path with fewer than two segments is its own category; `row.path` says that
          // without indexing into a split whose length the compiler cannot see.
          row.path

    totalByCurrency[currency] = (totalByCurrency[currency] ?? 0) + amount
    const byCurrency = categoryMap[category] ?? {}
    byCurrency[currency] = (byCurrency[currency] ?? 0) + amount
    categoryMap[category] = byCurrency

    // If this path is deeper than the category, record the direct child
    const categoryDepth = category.split(':').length
    if (segments.length > categoryDepth) {
      const children = directChildSets[category] ?? new Set()
      children.add(segments.slice(0, categoryDepth + 1).join(':'))
      directChildSets[category] = children
    }
  }

  const categories = Object.entries(categoryMap).map(([category, byCurrency]) => ({
    category,
    total: formatTotals(byCurrency),
    childCount: directChildSets[category]?.size ?? 0,
  }))

  return c.json({
    total: formatTotals(totalByCurrency),
    categories,
  })
})

// GET /api/reports/monthly-spend?months=N
//
// Returns an array of { month: "YYYY-MM", total: { CAD: "3200.00", ... } }
// for the past N calendar months (default 12), most recent last.
// All months in the window are included even if spend is zero.
// Same expense account filtering rules as /spending-summary.
app.get('/monthly-spend', async (c) => {
  const userId = c.get('userId')
  const monthsParam = c.req.query('months')
  const months = monthsParam ? parseInt(monthsParam, 10) : 12

  if (Number.isNaN(months) || months < 1 || months > 120) {
    return fail(c, 'FIELD_OUT_OF_RANGE', { field: 'months', min: 1, max: 120 })
  }

  // Build the window: from the first day of (months) ago to end of current month
  const now = new Date()
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
    .toISOString()
    .slice(0, 10)
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10)

  const settings = await loadClassifySettings(userId)
  const rows = await spendRows(userId, settings, { from: windowStart, to: windowEnd })

  // Build a map of all months in the window initialised to empty totals
  const monthMap: Record<string, Record<string, number>> = {}
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1 + i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    monthMap[key] = {}
  }

  // Accumulate spend into the month buckets
  for (const row of rows) {
    const bucket = monthMap[row.date.slice(0, 7)]
    // Rows outside the requested range land on a month with no bucket; skip them.
    if (!bucket) continue
    bucket[row.currency] = (bucket[row.currency] ?? 0) + money.cents(row.amount)
  }

  const result = Object.entries(monthMap).map(([month, byCurrency]) => ({
    month,
    total: formatTotals(byCurrency),
  }))

  return c.json(result)
})

// GET /api/reports/spending-fx-pairs?from=YYYY-MM-DD&to=YYYY-MM-DD&targetCurrency=CAD
//
// Returns the unique (date, from, to) rate pairs needed to convert all expense
// transactions in the period to targetCurrency. Checks the DB cache for each pair
// but does NOT fetch from any external source.
//
// Response: { pairs: [{ date, from, to, cached: boolean }] }
app.get('/spending-fx-pairs', async (c) => {
  const userId = c.get('userId')
  const { from, to, targetCurrency } = c.req.query()

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (!from || !dateRe.test(from)) return fail(c, 'FIELD_NOT_DATE', { field: 'from' })
  if (!to || !dateRe.test(to)) return fail(c, 'FIELD_NOT_DATE', { field: 'to' })
  if (!targetCurrency || !isValidCurrency(targetCurrency))
    return fail(c, 'UNSUPPORTED_CURRENCY', { currency: targetCurrency })

  const settings = await loadClassifySettings(userId)
  const rows = await spendRows(userId, settings, {
    from,
    to,
  })

  // Deduplicate to unique (date, currency) pairs, excluding the target currency
  const seen = new Set<string>()
  const uniquePairs: { date: string; from: string }[] = []
  for (const row of rows) {
    const dateStr = row.date
    if (row.currency === targetCurrency) continue
    const key = `${dateStr}:${row.currency}`
    if (!seen.has(key)) {
      seen.add(key)
      uniquePairs.push({ date: dateStr, from: row.currency })
    }
  }

  // Check DB cache for each pair
  const pairs = await Promise.all(
    uniquePairs.map(async ({ date, from: fromCurrency }) => {
      const [cached] = await db
        .select({ id: fxRates.id })
        .from(fxRates)
        .where(
          and(
            eq(fxRates.date, date),
            eq(fxRates.baseCurrency, fromCurrency),
            eq(fxRates.quoteCurrency, targetCurrency),
          ),
        )
        .limit(1)
      return { date, from: fromCurrency, to: targetCurrency, cached: !!cached }
    }),
  )

  return c.json({ pairs })
})

// GET /api/reports/spending-converted?from=YYYY-MM-DD&to=YYYY-MM-DD&targetCurrency=CAD
//
// Converts all expense transactions in the period to targetCurrency using DB-cached
// rates only (no external fetch). Returns the converted total if all rates are available,
// or null with a missingCount if any rates are missing from the cache.
//
// Response: { total: string | null, missingCount: number }
app.get('/spending-converted', async (c) => {
  const userId = c.get('userId')
  const { from, to, targetCurrency } = c.req.query()

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (!from || !dateRe.test(from)) return fail(c, 'FIELD_NOT_DATE', { field: 'from' })
  if (!to || !dateRe.test(to)) return fail(c, 'FIELD_NOT_DATE', { field: 'to' })
  if (!targetCurrency || !isValidCurrency(targetCurrency))
    return fail(c, 'UNSUPPORTED_CURRENCY', { currency: targetCurrency })

  const settings = await loadClassifySettings(userId)
  const rows = await spendRows(userId, settings, {
    from,
    to,
  })

  // Build a cache of rates needed: (date:fromCurrency) → rate string | null
  const rateCache = new Map<string, string | null>()
  for (const row of rows) {
    const dateStr = row.date
    if (row.currency === targetCurrency) continue
    const key = `${dateStr}:${row.currency}`
    if (!rateCache.has(key)) {
      const [cached] = await db
        .select({ rate: fxRates.rate })
        .from(fxRates)
        .where(
          and(
            eq(fxRates.date, dateStr),
            eq(fxRates.baseCurrency, row.currency),
            eq(fxRates.quoteCurrency, targetCurrency),
          ),
        )
        .limit(1)
      rateCache.set(key, cached?.rate ?? null)
    }
  }

  const missingCount = [...rateCache.values()].filter((r) => r === null).length
  if (missingCount > 0) {
    return c.json({ total: null, missingCount })
  }

  // In cents. An amount already in the target currency adds exactly; a converted one is a
  // float product of cents and rate, and the total is rounded to the cent once, at the end,
  // half away from zero as the ledger's own column rounds.
  let total = 0
  for (const row of rows) {
    const amount = money.cents(row.amount)
    if (row.currency === targetCurrency) {
      total += amount
    } else {
      const dateStr = row.date
      const rate = parseFloat(rateCache.get(`${dateStr}:${row.currency}`)!)
      total += amount * rate
    }
  }

  const rounded = Math.sign(total) * Math.round(Math.abs(total)) + 0
  return c.json({ total: money.format(rounded), missingCount: 0 })
})

/** Per-currency totals kept in cents, as the two-place strings the API has always answered. */
function formatTotals(byCurrency: Record<string, number>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(byCurrency).map(([currency, cents]) => [currency, money.format(cents)]),
  )
}

export default app
