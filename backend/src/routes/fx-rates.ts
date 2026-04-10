import { Hono } from 'hono'
import { db } from '../db'
import { fxRates } from '../db/schema'
import { and, eq } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// Returns a daily FX rate, fetching from frankfurter.app and caching in the DB if needed.
// Returns null if the date is today-or-future, or if the API has no data (e.g. some holidays).
export async function getOrFetchRate(
  date: string,
  baseCurrency: string,
  quoteCurrency: string,
): Promise<string | null> {
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

  const json = await res.json() as { rates?: Record<string, number> }
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

// GET /api/fx-rates?date=YYYY-MM-DD&from=EUR&to=CAD
// 200: { date, from, to, rate }
// 400: missing/invalid query params
// 404: rate unavailable for this date (future, weekend/holiday with no data)
app.get('/', async (c) => {
  const { date, from, to } = c.req.query()

  if (!date || !from || !to) {
    return c.json({ error: 'date, from, and to are required' }, 400)
  }

  const rate = await getOrFetchRate(date, from, to)
  if (rate === null) {
    return c.json({ error: 'rate unavailable for this date' }, 404)
  }

  return c.json({ date, from, to, rate })
})

export default app
