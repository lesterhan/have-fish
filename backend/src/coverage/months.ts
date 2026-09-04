// Classifying a calendar month against what the ledger actually records.
//
// The accounts page asks "how current is this figure"; a month asks a different question —
// "is this period recorded at all" — and the leading edge alone cannot answer it. An account
// covered Jan–Mar and Aug–Sep has a leading edge in September and a hole over July, so
// `coveredThrough` says nothing about whether July's spending is in the ledger.
//
// The scope is every tracked account, not merely the accounts with transactions in the month.
// That distinction is the whole point: an account whose statement was never imported has no
// transactions in the month *because* it was never imported, so classifying against the
// accounts that appear would read every neglected month as complete.

import { daysBetween, type CoverageInterval } from './intervals'

export type MonthCoverageState =
  // Every contributor covers the whole month.
  | 'complete'
  // Some of the month is recorded. Totals over it are floors, never values.
  | 'partial'
  // No contributor covers a single day of it. There is no total to report.
  | 'uncovered'

export type MonthGap = {
  accountId: string
  path: string
  name: string | null
  // How far into the month this account is recorded, or null when it covers none of it.
  coveredThrough: string | null
}

export type MonthCoverage = {
  // 'YYYY-MM'.
  month: string
  state: MonthCoverageState
  // The last day of the month every contributor covers, or null when not even the first day
  // is. For a complete month this equals `through`.
  completeThrough: string | null
  // The last day of the month that could be recorded — the month's end, or today for a month
  // still in progress. September cannot be behind on days that have not happened.
  through: string
  // Live accounts weighed. Zero means the month has nothing to be complete or incomplete
  // about, and a caller should say nothing rather than call it complete.
  contributors: number
  // Only the contributors that fall short, so a caller can name what is missing.
  gaps: MonthGap[]
}

export type MonthCoverageInput = {
  accountId: string
  path: string
  name: string | null
  // Merged and disjoint, as mergeCoverage returns them.
  intervals: CoverageInterval[]
  // Excluded from the reckoning for the same reason it is excluded from a rollup's as-of: an
  // account confirmed empty has nothing to contribute to a month, so being unrecorded for it
  // cannot make the month's total wrong.
  dormant: boolean
}

export function monthBounds(month: string, today: string): { from: string; through: string } {
  const [year, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return { from, through: end < today ? end : today }
}

// The last date d such that [from, d] is entirely covered, or null when `from` itself is not.
//
// One interval lookup is enough because mergeCoverage coalesces adjacent spans as well as
// overlapping ones: two spans that survive merging always have a real uncovered day between
// them, so the span containing `from` is where the unbroken prefix ends.
function coveredPrefix(
  intervals: CoverageInterval[],
  from: string,
  through: string,
): string | null {
  const holder = intervals.find((i) => i.fromDate <= from && from <= i.throughDate)
  if (!holder) return null
  return holder.throughDate < through ? holder.throughDate : through
}

function overlapsMonth(intervals: CoverageInterval[], from: string, through: string): boolean {
  return intervals.some((i) => i.fromDate <= through && i.throughDate >= from)
}

export function classifyMonth(
  accounts: readonly MonthCoverageInput[],
  month: string,
  today: string,
): MonthCoverage {
  const { from, through } = monthBounds(month, today)

  // A month that has not started yet is not unrecorded, it is unlived. Nobody is behind on it.
  if (daysBetween(from, through) < 0) {
    return { month, state: 'complete', completeThrough: null, through, contributors: 0, gaps: [] }
  }

  const live = accounts.filter((a) => !a.dormant)
  const gaps: MonthGap[] = []
  let completeThrough: string | null = through
  let anyCoverage = false

  for (const account of live) {
    if (overlapsMonth(account.intervals, from, through)) anyCoverage = true

    const prefix = coveredPrefix(account.intervals, from, through)
    if (prefix === through) continue

    gaps.push({
      accountId: account.accountId,
      path: account.path,
      name: account.name,
      coveredThrough: prefix,
    })
    // The month is complete only through its weakest contributor, and a contributor covering
    // none of it drops the answer to null however well the others did.
    if (prefix === null) completeThrough = null
    else if (completeThrough !== null && prefix < completeThrough) completeThrough = prefix
  }

  const state: MonthCoverageState =
    gaps.length === 0 ? 'complete' : anyCoverage ? 'partial' : 'uncovered'

  return { month, state, completeThrough, through, contributors: live.length, gaps }
}

export function classifyMonths(
  accounts: readonly MonthCoverageInput[],
  months: readonly string[],
  today: string,
): MonthCoverage[] {
  return months.map((month) => classifyMonth(accounts, month, today))
}

// Inclusive 'YYYY-MM' range, ascending. Rejects nothing — the route validates.
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  let [year, month] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`)
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return months
}
