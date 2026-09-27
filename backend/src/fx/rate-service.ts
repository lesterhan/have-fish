// Daily FX rates, cached in `fx_rates`. Reports read the cache only; the rate endpoints fill
// it from `rate-source.ts` when a day is missing.

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { fxRates } from '../db/schema'
import { fetchPublishedRate } from './rate-source'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The cached rate for one day and pair, or null. Never reaches the network. */
export async function cachedRate(
  date: string,
  baseCurrency: string,
  quoteCurrency: string,
): Promise<string | null> {
  const [cached] = await db
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.date, date),
        eq(fxRates.baseCurrency, baseCurrency),
        eq(fxRates.quoteCurrency, quoteCurrency),
      ),
    )
    .limit(1)
  return cached?.rate ?? null
}

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

  const cached = await cachedRate(date, baseCurrency, quoteCurrency)
  if (cached !== null) return cached

  const rateValue = await fetchPublishedRate(date, baseCurrency, quoteCurrency)
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
