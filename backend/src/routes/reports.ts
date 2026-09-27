import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { fail, failWith } from '../errors'
import {
  monthlySpend,
  spendingConverted,
  spendingFxPairs,
  spendingSummary,
} from '../reports/report-service'

// The spending page's reports. The handlers read the query and answer; which legs count as
// spending is `postings/spend-service`, the arithmetic is `reports/spending`.

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

  const result = await spendingSummary(userId, { from, to, prefix })
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
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

  return c.json(await monthlySpend(userId, months))
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

  return c.json(await spendingFxPairs(userId, from, to, targetCurrency))
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

  return c.json(await spendingConverted(userId, from, to, targetCurrency))
})

export default app
