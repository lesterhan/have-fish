// Made-up exchange rates that drift through the year. A rate depends only on its day, so a
// top-up converts at the rate a full seed would have.

import { minorUnits } from '@have-fish/core/currencies'
import { hash32 } from './random'

export const CURRENCIES = ['CAD', 'USD', 'EUR', 'CZK', 'CNY', 'JPY', 'NTD'] as const
export type Cur = (typeof CURRENCIES)[number]

/** CAD for one unit, around which each rate drifts. */
const BASE: Record<Cur, number> = {
  CAD: 1,
  USD: 1.39,
  EUR: 1.52,
  CZK: 0.0612,
  CNY: 0.192,
  JPY: 0.0091,
  NTD: 0.0428,
}

const DAY_MS = 86_400_000

/** CAD for one unit of `cur` on `date`: ±3% over a year, plus a little daily noise. */
export function rateOn(cur: Cur, date: string): number {
  if (cur === 'CAD') return 1
  const day = Date.parse(`${date}T00:00:00Z`) / DAY_MS
  const phase = (hash32(cur) % 365) / 365
  const season = 0.03 * Math.sin(2 * Math.PI * (day / 365 + phase))
  const noise = ((hash32(`${cur}:${date}`) % 1000) / 1000 - 0.5) * 0.006
  return BASE[cur] * (1 + season + noise)
}

/** `cents` rounded to what `cur` can carry: whole yen, cents for the rest. */
export function roundFor(cur: string, cents: number): number {
  return minorUnits(cur) === 0 ? Math.round(cents / 100) * 100 : Math.round(cents)
}

/** What `cents` of `from` is worth in `to` on `date`, at the market rate, rounded for `to`. */
export function convert(from: Cur, to: Cur, cents: number, date: string): number {
  return roundFor(to, (cents * rateOn(from, date)) / rateOn(to, date))
}
