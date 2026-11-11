// What a report asks of main: what went where over some days.

import { z } from 'zod'
import { date, type Money } from './wire'

export const reportInputs = {
  /** What went to each category from `start` to `end`, both days in it. */
  'report.spending': z.strictObject({ start: date, end: date }),
}

/** One spend's money in one category, as a report sums it. */
export type ReportedSpend = {
  /** The transaction's id. */
  id: string
  /** Its name without the root (`food:coffee`); `''` for unsorted. */
  category: string
  amount: string
}

export interface ReportValues {
  /**
   * In the home currency, `currency`, oldest day first. `other` is what went to categories in
   * each other currency, by code: none that sum to zero.
   */
  'report.spending': { currency: string; spent: ReportedSpend[]; other: Money[] }
}
