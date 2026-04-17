import { Hono } from 'hono'
import { db } from '../db'
import { transactions, postings, accounts, userSettings, fxRates } from '../db/schema'
import { eq, isNull, and, gte, lte, like } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'

const app = new Hono<{ Variables: AppVariables }>()

// Returns the user's configured expenses root path, with LIKE special chars escaped.
async function getExpensesRoot(userId: string): Promise<string> {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const root = settings?.defaultExpensesRootPath ?? 'expenses'
  return root.replace(/[%_\\]/g, '\\$&')
}

// GET /api/reports/spending-summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&prefix=expenses:food]
//
// Returns total spend and per-category breakdown for expense accounts only.
// Amounts are per currency (no conversion).
//
// Without prefix: categories are the first two path segments (e.g. "expenses:food").
// With prefix: filters to accounts under that prefix and groups one level deeper
// (e.g. prefix=expenses:food yields "expenses:food:restaurant", "expenses:food:groceries").
//
// Each category includes childCount — the number of distinct direct child categories
// that have spending in the period. childCount > 0 means the category is drillable.
app.get('/spending-summary', async (c) => {
  const userId = c.get('userId')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const prefix = c.req.query('prefix') || null

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (from && !dateRe.test(from)) return c.json({ error: 'Invalid from date, expected YYYY-MM-DD' }, 400)
  if (to && !dateRe.test(to)) return c.json({ error: 'Invalid to date, expected YYYY-MM-DD' }, 400)

  const expensesRoot = await getExpensesRoot(userId)

  if (prefix && !prefix.startsWith(`${expensesRoot}:`)) {
    return c.json({ error: 'prefix must be within the expenses root' }, 400)
  }

  // Escape LIKE special chars in prefix for safe use in the LIKE pattern
  const escapedPrefix = prefix ? prefix.replace(/[%_\\]/g, '\\$&') : null

  const rows = await db
    .select({
      path: accounts.path,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      isNull(accounts.deletedAt),
      // When a prefix is given, filter to that subtree; otherwise filter to all expenses
      escapedPrefix
        ? like(accounts.path, `${escapedPrefix}:%`)
        : like(accounts.path, `${expensesRoot}:%`),
      from ? gte(transactions.date, new Date(from)) : undefined,
      to ? lte(transactions.date, new Date(`${to}T23:59:59.999Z`)) : undefined,
    ))

  const totalByCurrency: Record<string, number> = {}
  const categoryMap: Record<string, Record<string, number>> = {}
  // Tracks distinct direct-child category paths per category, used to compute childCount
  const directChildSets: Record<string, Set<string>> = {}

  const prefixDepth = prefix ? prefix.split(':').length : 0

  for (const row of rows) {
    const amount = parseFloat(row.amount)
    const { currency } = row
    const segments = row.path.split(':')

    // Determine the category bucket this row falls into
    const category = prefix
      ? segments.slice(0, prefixDepth + 1).join(':')   // one level deeper than prefix
      : segments.length >= 2 ? `${segments[0]}:${segments[1]}` : segments[0]

    totalByCurrency[currency] = (totalByCurrency[currency] ?? 0) + amount
    categoryMap[category] ??= {}
    categoryMap[category][currency] = (categoryMap[category][currency] ?? 0) + amount

    // If this path is deeper than the category, record the direct child
    const categoryDepth = category.split(':').length
    if (segments.length > categoryDepth) {
      directChildSets[category] ??= new Set()
      directChildSets[category].add(segments.slice(0, categoryDepth + 1).join(':'))
    }
  }

  const categories = Object.entries(categoryMap).map(([category, byCurrency]) => ({
    category,
    total: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)])
    ),
    childCount: directChildSets[category]?.size ?? 0,
  }))

  return c.json({
    total: Object.fromEntries(
      Object.entries(totalByCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)])
    ),
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

  if (isNaN(months) || months < 1 || months > 120) {
    return c.json({ error: 'months must be a number between 1 and 120' }, 400)
  }

  // Build the window: from the first day of (months) ago to end of current month
  const now = new Date()
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))

  const expensesRoot = await getExpensesRoot(userId)

  const rows = await db
    .select({
      date: transactions.date,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      isNull(accounts.deletedAt),
      like(accounts.path, `${expensesRoot}:%`),
      gte(transactions.date, windowStart),
      lte(transactions.date, windowEnd),
    ))

  // Build a map of all months in the window initialised to empty totals
  const monthMap: Record<string, Record<string, number>> = {}
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1 + i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    monthMap[key] = {}
  }

  // Accumulate spend into the month buckets
  for (const row of rows) {
    const d = new Date(row.date)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    if (!(key in monthMap)) continue
    monthMap[key][row.currency] = (monthMap[key][row.currency] ?? 0) + parseFloat(row.amount)
  }

  const result = Object.entries(monthMap).map(([month, byCurrency]) => ({
    month,
    total: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)])
    ),
  }))

  return c.json(result)
})

// Returns the ISO week key "YYYY-W##" and the Monday date for a given date.
function isoWeek(date: Date): { key: string; monday: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7 // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - day + 1) // rewind to Monday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return {
    key: `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`,
    monday: d,
  }
}

// GET /api/reports/weekly-spend?weeks=N
//
// Returns an array of { week: "YYYY-W##", weekStart: "YYYY-MM-DD", total: { CAD: "..." } }
// for the past N calendar weeks (default 13 ≈ 3 months), oldest first.
// All weeks in the window are included even if spend is zero.
// Same expense account filtering rules as /spending-summary.
app.get('/weekly-spend', async (c) => {
  const userId = c.get('userId')
  const weeksParam = c.req.query('weeks')
  const weeks = weeksParam ? parseInt(weeksParam, 10) : 13

  if (isNaN(weeks) || weeks < 1 || weeks > 260) {
    return c.json({ error: 'weeks must be a number between 1 and 260' }, 400)
  }

  const { monday: currentWeekMonday } = isoWeek(new Date())
  // Window starts N-1 weeks before the current week's Monday
  const windowStart = new Date(currentWeekMonday)
  windowStart.setUTCDate(windowStart.getUTCDate() - (weeks - 1) * 7)
  const windowEnd = new Date(currentWeekMonday)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 6)
  windowEnd.setUTCHours(23, 59, 59, 999)

  const expensesRoot = await getExpensesRoot(userId)

  const rows = await db
    .select({
      date: transactions.date,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      isNull(accounts.deletedAt),
      like(accounts.path, `${expensesRoot}:%`),
      gte(transactions.date, windowStart),
      lte(transactions.date, windowEnd),
    ))

  // Pre-seed all weeks in the window
  const weekMap: Record<string, { weekStart: string; byCurrency: Record<string, number> }> = {}
  for (let i = 0; i < weeks; i++) {
    const monday = new Date(windowStart)
    monday.setUTCDate(monday.getUTCDate() + i * 7)
    const { key } = isoWeek(monday)
    const weekStart = monday.toISOString().slice(0, 10)
    weekMap[key] = { weekStart, byCurrency: {} }
  }

  // Accumulate spend into week buckets
  for (const row of rows) {
    const { key } = isoWeek(new Date(row.date))
    if (!(key in weekMap)) continue
    const { byCurrency } = weekMap[key]
    byCurrency[row.currency] = (byCurrency[row.currency] ?? 0) + parseFloat(row.amount)
  }

  const result = Object.entries(weekMap).map(([week, { weekStart, byCurrency }]) => ({
    week,
    weekStart,
    total: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)])
    ),
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
  if (!from || !dateRe.test(from)) return c.json({ error: 'Invalid from date' }, 400)
  if (!to || !dateRe.test(to)) return c.json({ error: 'Invalid to date' }, 400)
  if (!targetCurrency || !isValidCurrency(targetCurrency)) return c.json({ error: 'Invalid targetCurrency' }, 400)

  const expensesRoot = await getExpensesRoot(userId)

  const rows = await db
    .select({ date: transactions.date, currency: postings.currency })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      isNull(accounts.deletedAt),
      like(accounts.path, `${expensesRoot}:%`),
      gte(transactions.date, new Date(from)),
      lte(transactions.date, new Date(`${to}T23:59:59.999Z`)),
    ))

  // Deduplicate to unique (date, currency) pairs, excluding the target currency
  const seen = new Set<string>()
  const uniquePairs: { date: string; from: string }[] = []
  for (const row of rows) {
    const dateStr = new Date(row.date).toISOString().slice(0, 10)
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
        .where(and(
          eq(fxRates.date, date),
          eq(fxRates.baseCurrency, fromCurrency),
          eq(fxRates.quoteCurrency, targetCurrency),
        ))
        .limit(1)
      return { date, from: fromCurrency, to: targetCurrency, cached: !!cached }
    })
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
  if (!from || !dateRe.test(from)) return c.json({ error: 'Invalid from date' }, 400)
  if (!to || !dateRe.test(to)) return c.json({ error: 'Invalid to date' }, 400)
  if (!targetCurrency || !isValidCurrency(targetCurrency)) return c.json({ error: 'Invalid targetCurrency' }, 400)

  const expensesRoot = await getExpensesRoot(userId)

  const rows = await db
    .select({ date: transactions.date, amount: postings.amount, currency: postings.currency })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(postings.deletedAt),
      isNull(accounts.deletedAt),
      like(accounts.path, `${expensesRoot}:%`),
      gte(transactions.date, new Date(from)),
      lte(transactions.date, new Date(`${to}T23:59:59.999Z`)),
    ))

  // Build a cache of rates needed: (date:fromCurrency) → rate string | null
  const rateCache = new Map<string, string | null>()
  for (const row of rows) {
    const dateStr = new Date(row.date).toISOString().slice(0, 10)
    if (row.currency === targetCurrency) continue
    const key = `${dateStr}:${row.currency}`
    if (!rateCache.has(key)) {
      const [cached] = await db
        .select({ rate: fxRates.rate })
        .from(fxRates)
        .where(and(
          eq(fxRates.date, dateStr),
          eq(fxRates.baseCurrency, row.currency),
          eq(fxRates.quoteCurrency, targetCurrency),
        ))
        .limit(1)
      rateCache.set(key, cached?.rate ?? null)
    }
  }

  const missingCount = [...rateCache.values()].filter((r) => r === null).length
  if (missingCount > 0) {
    return c.json({ total: null, missingCount })
  }

  let total = 0
  for (const row of rows) {
    const amount = parseFloat(row.amount)
    if (row.currency === targetCurrency) {
      total += amount
    } else {
      const dateStr = new Date(row.date).toISOString().slice(0, 10)
      const rate = parseFloat(rateCache.get(`${dateStr}:${row.currency}`)!)
      total += amount * rate
    }
  }

  return c.json({ total: total.toFixed(2), missingCount: 0 })
})

export default app
