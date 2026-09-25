import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { isValidCurrency } from '../currencies'
import { db } from '../db'
import { fxRates } from '../db/schema'
import { fail } from '../errors'

const app = new Hono<{ Variables: AppVariables }>()

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Returns a daily FX rate, fetching from frankfurter.app and caching in the DB if needed.
// Returns null if the date is today-or-future, or if the API has no data (e.g. some holidays).
export async function getOrFetchRate(
  date: string,
  baseCurrency: string,
  quoteCurrency: string,
): Promise<string | null> {
  // The date goes into the path of the outbound URL, so nothing but a date gets that far,
  // whichever caller it came from.
  if (!ISO_DATE.test(date)) return null
  const today = new Date().toISOString().substring(0, 10)
  if (date >= today) return null

  // Check cache
  const [cached] = await db
    .select()
    .from(fxRates)
    .where(
      and(
        eq(fxRates.date, date),
        eq(fxRates.baseCurrency, baseCurrency),
        eq(fxRates.quoteCurrency, quoteCurrency),
      ),
    )
  if (cached) return cached.rate

  // Fetch from frankfurter.app
  // Response shape: { amount: 1, base: "EUR", date: "2024-01-15", rates: { "CAD": 1.4732 } }
  const url = `https://api.frankfurter.app/${date}?from=${baseCurrency}&to=${quoteCurrency}`
  const res = await fetch(url)
  if (!res.ok) return null

  const json = (await res.json()) as { rates?: Record<string, number> }
  const rateValue = json.rates?.[quoteCurrency]
  if (rateValue == null) return null

  const rateStr = rateValue.toFixed(6)

  // Cache and return — ignore conflicts in case of a race
  await db
    .insert(fxRates)
    .values({ date, baseCurrency, quoteCurrency, rate: rateStr })
    .onConflictDoNothing()

  return rateStr
}

// Frankfurter has no same-day rate, so for "what's the rate right now" we walk back
// from yesterday to the most recent day with published data (skips weekends/holidays
// where the API returns no rate). Returns the rate and the date it applies to so the
// UI can show an "as of {asOfDate}" hint.
export async function getRateAsOf(
  baseCurrency: string,
  quoteCurrency: string,
  maxLookbackDays = 7,
): Promise<{ rate: string; asOfDate: string } | null> {
  const today = new Date()
  for (let i = 0; i <= maxLookbackDays; i++) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const date = d.toISOString().substring(0, 10)
    const rate = await getOrFetchRate(date, baseCurrency, quoteCurrency)
    if (rate !== null) return { rate, asOfDate: date }
  }
  return null
}

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
