// What writing a rate asks of main: its input, and what it answers.

import { z } from 'zod'
import { date, typed } from './wire'

export const rateInputs = {
  /** A rate I typed for a day, from `currency` into the home currency: one of it is `rate`. */
  'rate.write': z.strictObject({ date, currency: typed(8), rate: typed(64) }),
}

export interface RateValues {
  /** The rate document, new or a new version of the day's. */
  'rate.write': { id: string }
}

/** What an undo step of a rate is called. */
export type RateStep = { action: 'writeRate'; currency: string; date: string }
