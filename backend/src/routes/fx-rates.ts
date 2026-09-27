import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { fail } from '../errors'
import { getOrFetchRate, getRateAsOf } from '../fx/rate-service'

const app = new Hono<{ Variables: AppVariables }>()

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// The rates and the cache are in `fx/rate-service.ts`; the one outbound fetch is in
// `fx/rate-source.ts`.

// GET /api/fx-rates/as-of?from=EUR&to=CAD
// 200: { from, to, rate, asOfDate }  — most recent published rate (see getRateAsOf)
// 400: missing/invalid query params
// 404: no rate available in the lookback window
app.get('/as-of', async (c) => {
  const { from, to } = c.req.query()

  if (!from || !to) {
    return fail(c, 'FIELDS_REQUIRED', { fields: ['from', 'to'] })
  }

  if (!isValidCurrency(from) || !isValidCurrency(to)) {
    return fail(c, 'UNSUPPORTED_CURRENCY', { currency: isValidCurrency(from) ? to : from })
  }

  const result = await getRateAsOf(from, to)
  if (result === null) {
    return fail(c, 'FX_RATE_UNAVAILABLE')
  }

  return c.json({ from, to, ...result })
})

// GET /api/fx-rates?date=YYYY-MM-DD&from=EUR&to=CAD
// 200: { date, from, to, rate }
// 400: missing/invalid query params
// 404: rate unavailable for this date (future, weekend/holiday with no data)
app.get('/', async (c) => {
  const { date, from, to } = c.req.query()

  if (!date || !from || !to) {
    return fail(c, 'FIELDS_REQUIRED', { fields: ['date', 'from', 'to'] })
  }

  if (!ISO_DATE.test(date)) return fail(c, 'FIELD_NOT_DATE', { field: 'date' })

  if (!isValidCurrency(from) || !isValidCurrency(to)) {
    return fail(c, 'UNSUPPORTED_CURRENCY', { currency: isValidCurrency(from) ? to : from })
  }

  const rate = await getOrFetchRate(date, from, to)
  if (rate === null) {
    return fail(c, 'FX_RATE_UNAVAILABLE_FOR_DATE')
  }

  return c.json({ date, from, to, rate })
})

export default app
