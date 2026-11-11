// What a recorded ledger holds, so a scene can replay it: the whole list and each list the
// window asks for, made once from a seed profile. Plain JSON, written by `scenes:record`,
// never committed.

import type {
  DayNet,
  ListedAccount,
  ListedDay,
  ListedPath,
  ListedTransaction,
  Values,
} from '../shared/commands'

export type Fixture = {
  /** The seed profile it was recorded from. */
  profile: string
  /** The seed it was made with; the same seed makes the same ledger. */
  seed: string
  /** The day the ledger ends, and the page's clock: `YYYY-MM-DD`. */
  today: string
  /** The home currency a report answers in. */
  currency: string
  /** The whole list, in its order. */
  rows: ListedTransaction[]
  days: ListedDay[]
  /** Every day's. */
  nets: DayNet[]
  accounts: ListedAccount[]
  paths: ListedPath[]
  assumedFrom: string | null
  /** Each recorded week, by its start. */
  reports: Record<string, Values['report.spending']>
}

/** The day every fixture ends: the sheet's own today, so a shot doesn't move with the calendar. */
export const SCENE_TODAY = '2026-11-05'

/** Noon of `today` on this machine, in ms: what `Date.now` answers in a scene. */
export function noonOf(today: string): number {
  return new Date(`${today}T12:00:00`).getTime()
}

/** The fixture of a ledger with nothing in it; the empty profile has no ledger to record. */
export const EMPTY: Fixture = {
  profile: 'empty',
  seed: '',
  today: SCENE_TODAY,
  currency: '',
  rows: [],
  days: [],
  nets: [],
  accounts: [],
  paths: [],
  assumedFrom: null,
  reports: {},
}
