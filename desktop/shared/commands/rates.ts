// What writing or fetching a rate asks of main: its input, and what it answers.

import { z } from 'zod'
import { date, typed } from './wire'

// One rate I typed: its day, its currency, and one of it in the home currency.
const aRate = z.strictObject({ date, currency: typed(8), rate: typed(64) })

// One day and currency a fetch asks the published rate of: one of it in the home currency.
const aDay = z.strictObject({ date, currency: typed(8) })

/** Whether each day and currency is in `rates` once. */
function eachOnce(rates: readonly { date: string; currency: string }[]): boolean {
  return new Set(rates.map((one) => `${one.date} ${one.currency}`)).size === rates.length
}

export const rateInputs = {
  /** A rate I typed for a day, from `currency` into the home currency: one of it is `rate`. */
  'rate.write': aRate,
  /** Several rates I typed, written as one step: each day and currency once. */
  'rate.writeAll': z.strictObject({ rates: z.array(aRate).min(1).max(100).refine(eachOnce) }),
  /** Every published rate for each day and currency, fetched as one step: each day once. */
  'rate.fetch': z.strictObject({ days: z.array(aDay).min(1).max(200).refine(eachOnce) }),
}

export interface RateValues {
  /** The rate document, new or a new version of the day's. */
  'rate.write': { id: string }
  /** Each rate document, in the order the rates were given. */
  'rate.writeAll': { ids: string[] }
  /** Each rate document fetched, in the order its days came; a day with none published has none. */
  'rate.fetch': { ids: string[] }
}

/** What an undo step of a rate is called. */
export type RateStep =
  | { action: 'writeRate'; currency: string; date: string }
  | { action: 'writeAllRates'; count: number }
  | { action: 'fetchRates'; count: number }
