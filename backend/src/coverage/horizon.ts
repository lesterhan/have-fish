// The horizon: the most recent date for which an account's data is actually obtainable.
//
// "Caught up" cannot mean "covered through today". Wise hands over any date range on demand,
// but a credit card only produces a statement when its cycle closes — a card closing on the
// 25th *cannot* be covered through the 20th, and asking for it is asking the user to fix the
// bank. So each account gets a horizon, and coverage reaching the horizon is the finish line.
// The span between horizon and today is "not yet available", never a gap and never work.

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { accountCoverage, userSettings } from '../db/schema'
import { addDays, daysBetween, type CoverageInterval } from './intervals'

// How data comes out of the institution.
//   'range'  — any date range, any time (Wise, most chequing accounts). Horizon is today.
//   'cycle'  — fixed statement periods (credit cards). Horizon is the last released statement.
export type ExportMode = 'range' | 'cycle'

export type CoverageConfig = {
  exportMode: ExportMode
  // Day of month the statement closes, 1-31. Only meaningful when exportMode is 'cycle'.
  // Clamped to the month's length on use, so 31 means "last day of the month".
  cycleDay: number | null
  // Days after the cycle closes before the statement is actually downloadable.
  releaseLag: number
  // Whether the coach asks about this account at all.
  tracked: boolean
}

// What a user may pin by hand. Every field optional — only overrides are stored, and anything
// absent falls through to inference.
export type CoverageConfigOverride = Partial<CoverageConfig>

// Assumed when nothing is known. 'range' is the deliberate default: it puts the horizon at
// today, which can only ever *over*-report a gap. Defaulting to 'cycle' would move the
// horizon backwards and hide real missing days, which is the one failure this feature must
// never have — a coach that quietly stops asking is worse than one that asks too often.
export const DEFAULT_CONFIG: CoverageConfig = {
  exportMode: 'range',
  cycleDay: null,
  releaseLag: 0,
  tracked: true,
}

// Inference will not guess from fewer than this many intervals. Two monthly statements are a
// coincidence; three are a rhythm.
const MIN_INTERVALS_TO_INFER = 3

// How far back to sample when looking for a rhythm. Enough to see a pattern, recent enough
// that a cycle day the bank changed a year ago doesn't outvote the current one.
const INFERENCE_SAMPLE_SIZE = 6

// --- date helpers -----------------------------------------------------------------------

// Month is 1-12. Day 0 of the following month is the last day of this one.
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// Builds 'YYYY-MM-DD' for the given day, pulled back to the last day of the month when the
// month is too short. This is what makes cycleDay 31 mean "month end": it resolves to Feb 28
// in a common year and Feb 29 in a leap year, rather than spilling into March.
export function dateInMonth(year: number, month: number, day: number): string {
  const clamped = Math.min(day, daysInMonth(year, month))
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

function isLastDayOfMonth(date: string): boolean {
  const { year, month, day } = parts(date)
  return day === daysInMonth(year, month)
}

// --- horizon ----------------------------------------------------------------------------

// The most recent date whose data the user could actually have.
//
// For 'range', that is today. For 'cycle', it is the latest cycle close C where
// C + releaseLag <= today — walking back a month at a time until a statement has both closed
// and been released. A card that closed yesterday with a three-day release lag still has last
// month's statement as its horizon, because this month's is not downloadable yet.
export function horizon(config: CoverageConfig, today: string): string {
  // A cycle account with no known cycle day can't have its closes computed. Falling back to
  // today over-reports rather than inventing a boundary — same reasoning as DEFAULT_CONFIG.
  if (config.exportMode !== 'cycle' || config.cycleDay == null) return today

  let { year, month } = parts(today)

  // Bounded rather than while(true): a nonsensical releaseLag that no close can satisfy would
  // otherwise spin forever. Two years back is far past any real statement lag.
  for (let i = 0; i < 24; i++) {
    const close = dateInMonth(year, month, config.cycleDay)
    if (addDays(close, config.releaseLag) <= today) return close
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }

  return today
}

// The next cycle close after the current horizon — what "next statement Mar 25" is read off.
// Null for 'range' accounts, which have no next boundary to wait for.
export function nextHorizon(config: CoverageConfig, today: string): string | null {
  if (config.exportMode !== 'cycle' || config.cycleDay == null) return null

  const current = horizon(config, today)
  let { year, month } = parts(current)
  month += 1
  if (month === 13) {
    month = 1
    year += 1
  }

  return dateInMonth(year, month, config.cycleDay)
}

// --- inference --------------------------------------------------------------------------

// Reads a statement rhythm off the coverage intervals already recorded for an account.
// Returns null whenever the evidence is thin or ambiguous.
//
// Deliberately strict. A wrong 'cycle' guess moves the horizon backwards and hides real
// uncovered days; a wrong 'range' guess only asks a question the user can wave off with one
// click. The costs are not symmetric, so anything short of an unmistakable monthly pattern
// declines to guess.
//
// Only the interval end dates are examined. Transaction dates are not consulted despite being
// available: spending is continuous and its rhythm reflects paydays and habits, not when the
// bank closes a statement. Reading a cycle day out of it would be guessing with extra steps.
//
// releaseLag is never inferred either. The only observable proxy is the delay between an
// interval's throughDate and when the row was created — but that measures how long the user
// took to get around to importing, which is precisely the thing this whole feature exists
// because it is unpredictable. It stays 0 until the user says otherwise.
export function inferCycleFromIntervals(intervals: CoverageInterval[]): CoverageConfigOverride | null {
  if (intervals.length < MIN_INTERVALS_TO_INFER) return null

  // Most recent first, so a bank that changed its cycle day is judged on its current one.
  const ends = [...intervals]
    .map((i) => i.throughDate)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, INFERENCE_SAMPLE_SIZE)

  // Consecutive closes must be roughly a month apart. This is what rejects a pile of ad-hoc
  // range exports that happen to share a day of month.
  for (let i = 0; i < ends.length - 1; i++) {
    const daysApart = daysBetween(ends[i + 1], ends[i])
    if (daysApart < 26 || daysApart > 33) return null
  }

  // Month-end statements land on 31, 30, 28 or 29 depending on the month, so they agree on
  // "last day" rather than on a number. cycleDay 31 clamps to exactly that.
  if (ends.every(isLastDayOfMonth)) {
    return { exportMode: 'cycle', cycleDay: 31 }
  }

  const days = ends.map((d) => parts(d).day)
  if (days.every((d) => d === days[0])) {
    return { exportMode: 'cycle', cycleDay: days[0] }
  }

  return null
}

// --- config resolution --------------------------------------------------------------------

// Coerces one stored override, which may have been hand-edited into the JSONB, into something
// safe to merge. Anything unrecognised is dropped rather than trusted.
function sanitizeOverride(raw: unknown): CoverageConfigOverride {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const override: CoverageConfigOverride = {}

  if (source.exportMode === 'range' || source.exportMode === 'cycle') {
    override.exportMode = source.exportMode
  }
  if (source.cycleDay === null) {
    override.cycleDay = null
  } else if (isCycleDay(source.cycleDay)) {
    override.cycleDay = source.cycleDay
  }
  if (isReleaseLag(source.releaseLag)) {
    override.releaseLag = source.releaseLag
  }
  if (typeof source.tracked === 'boolean') {
    override.tracked = source.tracked
  }

  return override
}

export function isCycleDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31
}

// Capped at a month: a lag longer than the cycle itself would mean a statement is never
// available before the next one closes, which no institution does and which would make the
// horizon walk back indefinitely.
export function isReleaseLag(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 31
}

// Defaults, then inference, then the user's override — each layer wins over the one before.
// The override is last because the user can see their own statements and the inference cannot.
export function mergeConfig(
  inferred: CoverageConfigOverride | null,
  override: CoverageConfigOverride,
): CoverageConfig {
  return { ...DEFAULT_CONFIG, ...(inferred ?? {}), ...override }
}

// Every catchUp override for a user, keyed by account id. Read once per request rather than
// per account — story 3 walks every tracked account and would otherwise issue N queries for
// one row of JSON.
export async function readCatchUpOverrides(
  userId: string,
): Promise<Record<string, CoverageConfigOverride>> {
  const [settings] = await db
    .select({ preferences: userSettings.preferences })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))

  const preferences = settings?.preferences as Record<string, unknown> | undefined
  const catchUp = preferences?.catchUp
  if (typeof catchUp !== 'object' || catchUp === null || Array.isArray(catchUp)) return {}

  const overrides: Record<string, CoverageConfigOverride> = {}
  for (const [accountId, raw] of Object.entries(catchUp as Record<string, unknown>)) {
    overrides[accountId] = sanitizeOverride(raw)
  }
  return overrides
}

// The live coverage assertions for one account, oldest first.
export async function readIntervals(userId: string, accountId: string): Promise<CoverageInterval[]> {
  return db
    .select({ fromDate: accountCoverage.fromDate, throughDate: accountCoverage.throughDate })
    .from(accountCoverage)
    .where(
      and(
        eq(accountCoverage.userId, userId),
        eq(accountCoverage.accountId, accountId),
        isNull(accountCoverage.deletedAt),
      ),
    )
}

// The config actually in force for one account: inference over its coverage history, with any
// user override laid on top.
export async function effectiveConfig(userId: string, accountId: string): Promise<CoverageConfig> {
  const [intervals, overrides] = await Promise.all([
    readIntervals(userId, accountId),
    readCatchUpOverrides(userId),
  ])

  return mergeConfig(inferCycleFromIntervals(intervals), overrides[accountId] ?? {})
}
