// Turning coverage, transactions and config into the one thing the coach actually shows:
// per account, is there anything to do, and how much of it.
//
// Pure assembly — every input is passed in so the whole shape can be tested without a
// database. routes/catch-up.ts does the querying.

import { addDays, daysBetween, mergeCoverage, type CoverageInterval } from './intervals'
import { horizon, nextHorizon, type CoverageConfig } from './horizon'

// 'unset' means no coverage has ever been asserted for this account — distinct from 'behind',
// because it is not evidence of neglect, only of a feature that has never been used. It drives
// the bootstrap step rather than the queue.
export type CatchUpState = 'current' | 'behind' | 'unset'

export type CatchUpGap = {
  from: string
  through: string
  days: number
}

export type CatchUpAccount = {
  accountId: string
  path: string
  name: string | null
  state: CatchUpState
  horizon: string
  // Why the horizon is where it is — 'today' for accounts that export on demand, 'statement'
  // for ones gated by a cycle close. The UI needs this to say "next statement Aug 25" instead
  // of implying the user is behind on days the bank hasn't published yet.
  horizonReason: 'today' | 'statement'
  nextHorizonDate: string | null
  coveredThrough: string | null
  gap: CatchUpGap | null
  // Rough size of the job: gap days x the account's own historical rate. Null when there is
  // not enough covered history to estimate from — an honest "unknown" beats a confident zero.
  expectedTxns: number | null
  // Dates inside the gap that already have transactions — the splits entered from the phone
  // mid-trip. Evidence the account is live, never evidence the range is complete.
  txnDatesInGap: string[]
  dormant: boolean
  // The span of ledger history that already exists for this account. Null on an account with
  // no transactions at all. Bootstrap proposes exactly this range as the starting line: the
  // user has been using the app, so what is already entered is presumed real.
  firstTxnDate: string | null
  lastTxnDate: string | null
  config: CoverageConfig
}

export type CatchUpAccountInput = {
  accountId: string
  path: string
  name: string | null
  config: CoverageConfig
  intervals: CoverageInterval[]
  // Transaction counts by date for this account, as { 'YYYY-MM-DD': count }. Bounded by the
  // query's lookback window, so it cannot be used to find the account's oldest transaction.
  txnCountsByDate: Record<string, number>
  // The full history span, queried without a lookback bound.
  firstTxnDate: string | null
  lastTxnDate: string | null
}

// Trailing window the transactions/day rate is measured over. Long enough to smooth out a
// quiet month, short enough that a spending pattern from three years ago doesn't set today's
// expectation.
const RATE_WINDOW_DAYS = 365

// Below this much covered history the rate is noise, so expectedTxns declines to guess.
const MIN_COVERED_DAYS_FOR_RATE = 14

// Dormancy needs more evidence than the rate does: a month of confirmed-empty history before
// an account is sorted to the bottom of the queue.
const MIN_COVERED_DAYS_FOR_DORMANCY = 30

// Total days across a set of disjoint intervals, inclusive at both ends.
function totalDays(intervals: CoverageInterval[]): number {
  return intervals.reduce((sum, i) => sum + daysBetween(i.fromDate, i.throughDate) + 1, 0)
}

// The portion of each span falling inside [from, through]. Used to measure the rate over a
// recent window rather than over an account's whole life.
function clipToWindow(intervals: CoverageInterval[], from: string, through: string): CoverageInterval[] {
  const clipped: CoverageInterval[] = []
  for (const interval of intervals) {
    const start = interval.fromDate > from ? interval.fromDate : from
    const end = interval.throughDate < through ? interval.throughDate : through
    if (start <= end) clipped.push({ fromDate: start, throughDate: end })
  }
  return clipped
}

function datesIn(counts: Record<string, number>, from: string, through: string): string[] {
  return Object.keys(counts).filter((d) => d >= from && d <= through).sort()
}

function sumWithin(counts: Record<string, number>, intervals: CoverageInterval[]): number {
  let total = 0
  for (const [date, count] of Object.entries(counts)) {
    if (intervals.some((i) => date >= i.fromDate && date <= i.throughDate)) total += count
  }
  return total
}

export function assembleAccount(input: CatchUpAccountInput, today: string): CatchUpAccount {
  const { accountId, path, name, config, intervals, txnCountsByDate, firstTxnDate, lastTxnDate } = input

  const merged = mergeCoverage(intervals)
  const accountHorizon = horizon(config, today)
  const horizonReason = config.exportMode === 'cycle' && config.cycleDay != null ? 'statement' : 'today'

  // The leading edge is the last span, full stop. Older holes are real and stay in the data,
  // but they are never surfaced — a 2019 gap sitting in a queue forever is the definition of
  // the nagging this feature exists to avoid.
  const leadingEdge = merged.at(-1) ?? null
  const coveredThrough = leadingEdge?.throughDate ?? null

  let state: CatchUpState
  let gap: CatchUpGap | null = null

  if (merged.length === 0) {
    state = 'unset'
  } else if (coveredThrough! >= accountHorizon) {
    // Covered to the horizon is the finish line, even when the horizon is weeks behind today.
    state = 'current'
  } else {
    state = 'behind'
    const from = addDays(coveredThrough!, 1)
    gap = { from, through: accountHorizon, days: daysBetween(from, accountHorizon) + 1 }
  }

  const txnDatesInGap = gap ? datesIn(txnCountsByDate, gap.from, gap.through) : []

  // Rate is measured over covered days only. Uncovered days have no transactions precisely
  // because they have not been imported yet — dividing by them would read every neglected
  // account as quiet, which is exactly backwards.
  const windowStart = addDays(today, -(RATE_WINDOW_DAYS - 1))
  const recentCovered = clipToWindow(merged, windowStart, today)
  const coveredDays = totalDays(recentCovered)
  const coveredTxns = sumWithin(txnCountsByDate, recentCovered)

  const expectedTxns = gap && coveredDays >= MIN_COVERED_DAYS_FOR_RATE
    ? Math.round((coveredTxns / coveredDays) * gap.days)
    : null

  // Quiet for a confirmed stretch, and nothing has landed in the open window. The second half
  // is the revival rule: a transaction dated inside the gap — a split entered from the phone
  // on holiday — pulls the account straight back up the queue.
  const dormant =
    coveredDays >= MIN_COVERED_DAYS_FOR_DORMANCY &&
    coveredTxns === 0 &&
    txnDatesInGap.length === 0

  return {
    accountId,
    path,
    name,
    state,
    horizon: accountHorizon,
    horizonReason,
    nextHorizonDate: nextHorizon(config, today),
    coveredThrough,
    gap,
    expectedTxns,
    txnDatesInGap,
    dormant,
    firstTxnDate,
    lastTxnDate,
    config,
  }
}

// Smallest gap first, dormant last.
//
// Momentum beats triage: finishing the account that is two days behind makes the next one
// feel possible, where opening with the 200-day monster makes the whole thing feel like the
// pile it already was.
export function sortAccounts(accounts: CatchUpAccount[]): CatchUpAccount[] {
  const stateRank = (a: CatchUpAccount) => (a.state === 'behind' ? 0 : a.state === 'unset' ? 1 : 2)

  return [...accounts].sort((a, b) => {
    if (a.dormant !== b.dormant) return a.dormant ? 1 : -1
    if (stateRank(a) !== stateRank(b)) return stateRank(a) - stateRank(b)
    if (a.gap && b.gap && a.gap.days !== b.gap.days) return a.gap.days - b.gap.days
    return a.path.localeCompare(b.path)
  })
}

export type CatchUpSummary = {
  current: number
  behind: number
  unset: number
  tracked: number
  dormant: number
  // What the dashboard tile counts. Accounts, never days — "4 accounts to catch up" is
  // actionable, "63 days behind" is only guilt.
  accountsToCatchUp: number
  progress: { current: number; tracked: number }
}

export function summarize(accounts: CatchUpAccount[]): CatchUpSummary {
  const count = (state: CatchUpState) => accounts.filter((a) => a.state === state).length
  const current = count('current')

  return {
    current,
    behind: count('behind'),
    unset: count('unset'),
    tracked: accounts.length,
    dormant: accounts.filter((a) => a.dormant).length,
    accountsToCatchUp: accounts.filter((a) => a.state === 'behind').length,
    progress: { current, tracked: accounts.length },
  }
}
