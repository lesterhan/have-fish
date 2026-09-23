import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { db } from '../db'
import { accounts, fxRates, postings, transactions } from '../db/schema'
import { fail } from '../errors'
import type { StoredAccountType } from '../postings/account-type'
import { typeFilterCondition, underPathCondition } from '../postings/account-type-sql'
import { loadClassifySettings } from '../postings/classify-service'
import { type ClassifySettings, isExpenseSubject } from '../postings/roles'

const app = new Hono<{ Variables: AppVariables }>()

// Every spending report is a sum over the same rows, so they are fetched in one place.
const EXPENSE_TYPE = new Set<StoredAccountType>(['expense'])

type SpendRow = {
  accountId: string
  path: string
  date: Date
  amount: string
  currency: string
}

/**
 * The postings every spending report is computed over: the genuine spend legs in the period,
 * with the mechanical legs of a cross-currency spend already removed.
 *
 * Selection is by RESOLVED account type — the stored override, else what the path root infers
 * — not by `LIKE 'expenses:%'`. That was BUG-007's last hiding place: a category at an
 * atypically-named root, tagged Expense on its own settings page, matched no LIKE pattern, so
 * every spend into it was absent from the total, the breakdown and the trend, with no row to
 * notice was missing.
 *
 * The SQL is an over-inclusive prefilter and `isExpenseSubject` is the verdict — the same
 * split `GET /api/accounts/balances` uses. It has to be the real classifier now: the old
 * fee-and-conversion id set stood in for it only because the LIKE already guaranteed every
 * row was an expense leg, and that premise goes with the LIKE. A clearing account someone
 * has tagged Expense, say, now reaches the prefilter, and it is a `share` leg — a role the
 * id set has no way to express. So this runs the function written for exactly this question,
 * which until now had no caller at all.
 */
async function spendRows(
  userId: string,
  settings: ClassifySettings,
  opts: { from?: Date; to?: Date; prefix?: string | null } = {},
): Promise<SpendRow[]> {
  const rows = await db
    .select({
      accountId: postings.accountId,
      path: accounts.path,
      type: accounts.type,
      date: transactions.date,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(postings.deletedAt),
        isNull(accounts.deletedAt),
        typeFilterCondition(EXPENSE_TYPE, settings.roots),
        opts.prefix ? underPathCondition(opts.prefix) : undefined,
        opts.from ? gte(transactions.date, opts.from) : undefined,
        opts.to ? lte(transactions.date, opts.to) : undefined,
      ),
    )

  return rows
    .filter((r) => isExpenseSubject(asRolePosting(r), settings))
    .map(({ type: _prefilterInput, ...row }) => row)
}

/** The classifier's view of a fetched row. Its three fields, named the way it names them. */
function asRolePosting(row: { accountId: string; path: string; type: string | null }) {
  return { accountId: row.accountId, accountPath: row.path, accountType: row.type }
}

/**
 * True when at least one of this user's accounts resolves to an expense at or under `prefix`.
 *
 * Guards the drill-down: `?prefix=assets:chequing` is a caller mistake, not an empty report.
 * Asked of the resolved type rather than of the configured expenses root, for the same reason
 * the rows are — a drill into a tagged category at an atypical root is a legitimate request,
 * and the root test refused it.
 */
async function hasExpenseAccountUnder(userId: string, settings: ClassifySettings, prefix: string) {
  const candidates = await db
    .select({ accountId: accounts.id, path: accounts.path, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
        typeFilterCondition(EXPENSE_TYPE, settings.roots),
        underPathCondition(prefix),
      ),
    )
  // A fee or conversion account is an expense account the reports never sum, so a prefix that
  // reaches only those is as empty as one that reaches none.
  return candidates.some((a) => isExpenseSubject(asRolePosting(a), settings))
}

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
    ...(from ? { from: new Date(from) } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999Z`) } : {}),
  })

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
    total: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)]),
    ),
    childCount: directChildSets[category]?.size ?? 0,
  }))

  return c.json({
    total: Object.fromEntries(
      Object.entries(totalByCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)]),
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

  if (Number.isNaN(months) || months < 1 || months > 120) {
    return fail(c, 'FIELD_OUT_OF_RANGE', { field: 'months', min: 1, max: 120 })
  }

  // Build the window: from the first day of (months) ago to end of current month
  const now = new Date()
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
  const windowEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  )

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
    const d = new Date(row.date)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const bucket = monthMap[key]
    // Rows outside the requested range land on a month with no bucket; skip them.
    if (!bucket) continue
    bucket[row.currency] = (bucket[row.currency] ?? 0) + parseFloat(row.amount)
  }

  const result = Object.entries(monthMap).map(([month, byCurrency]) => ({
    month,
    total: Object.fromEntries(
      Object.entries(byCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)]),
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
  if (!from || !dateRe.test(from)) return fail(c, 'FIELD_NOT_DATE', { field: 'from' })
  if (!to || !dateRe.test(to)) return fail(c, 'FIELD_NOT_DATE', { field: 'to' })
  if (!targetCurrency || !isValidCurrency(targetCurrency))
    return fail(c, 'UNSUPPORTED_CURRENCY', { currency: targetCurrency })

  const settings = await loadClassifySettings(userId)
  const rows = await spendRows(userId, settings, {
    from: new Date(from),
    to: new Date(`${to}T23:59:59.999Z`),
  })

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
    from: new Date(from),
    to: new Date(`${to}T23:59:59.999Z`),
  })

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
