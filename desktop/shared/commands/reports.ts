// What a report asks of main: what went where over some days.

import type { Mark } from '@have-fish/core/rate-for'
import { z } from 'zod'
import { date } from './wire'

export const reportInputs = {
  /** What went to each category from `start` to `end`, both days in it. */
  'report.spending': z.strictObject({ start: date, end: date }),
}

/** Why a spend's rate is a guess: its day and currency, and the day it borrowed from. */
export type Guess = {
  date: string
  currency: string
  /** The day borrowed from and its rate to four figures; null when there was none. */
  from: { date: string; rate: string } | null
}

/** One spend's money in one category, as a report sums it. */
export type ReportedSpend = {
  /** The transaction's id. */
  id: string
  /** Its name without the root (`food:coffee`); `''` for unsorted. */
  category: string
  amount: string
  /** How good the rate it was converted at is: `exact` when it was in `currency`. */
  mark: Mark
  /** Its day and currency when `mark` is borrowed or missing, and never else. */
  guess?: Guess
}

export interface ReportValues {
  /**
   * In the home currency, `currency`, oldest day first: each spend in another currency at the best
   * rate there is, with its mark; one with none counts 0.00, marked `missing`.
   */
  'report.spending': { currency: string; spent: ReportedSpend[] }
}
