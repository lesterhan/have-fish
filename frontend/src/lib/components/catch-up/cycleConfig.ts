/**
 * The catch-up cycle model, as the settings modal has to present and commit it.
 *
 * Two things make this more than a form. First, every field is three-valued: pinned by hand,
 * inferred from the account's statement history, or defaulted — and "hand this back to
 * automatic" is only offerable when the UI can tell which. Second, `exportMode` and `cycleDay`
 * are not independent: the route refuses a cycle account with no cycle day, because such an
 * account would behave exactly like a range one while claiming not to.
 *
 * Relative imports, not $lib — see lib-imports.test.ts.
 */

import type { CoverageExportMode } from '../../api'

/**
 * "No pin — use whatever inference says." The empty string rather than null or undefined so
 * it can sit in a `<select>` value, and so a real `0` release lag can never be mistaken for
 * it by a falsy check.
 */
export const AUTOMATIC = '' as const
export type Automatic = typeof AUTOMATIC

export type ModeChoice = Automatic | CoverageExportMode
export type DayChoice = Automatic | number

/** What inference alone concluded, independent of anything the user pinned. */
export type Inference = {
  mode: CoverageExportMode | null
  day: number | null
}

export type CyclePatch = {
  exportMode: CoverageExportMode | null
  cycleDay: number | null
}

export type CycleCommit =
  | { status: 'send'; patch: CyclePatch }
  | { status: 'incomplete'; reason: string }

/** Mirrors DEFAULT_CONFIG in backend/src/coverage/horizon.ts — keep the two in step. */
const DEFAULT_MODE: CoverageExportMode = 'range'
const DEFAULT_RELEASE_LAG = 0

/**
 * A `<select>` value as a choice. The DOM only ever hands back strings, and '0' is a real
 * release lag — so this cannot be a truthiness check, which is the bug the whole AUTOMATIC
 * sentinel exists to make impossible.
 */
export function toDayChoice(raw: string): DayChoice {
  if (raw === AUTOMATIC) return AUTOMATIC
  const n = Number(raw)
  return Number.isInteger(n) ? n : AUTOMATIC
}

/** 1 → "1st", 22 → "22nd". The teens are the whole reason this is not a lookup on the last digit. */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/**
 * The labels on each row's "automatic" option.
 *
 * They name the value automatic would resolve to, so choosing it is not a blind choice —
 * the same reason the account type row reads "Auto (inferred: Asset)".
 */
export function cycleDayLabel(inferredDay: number | null | undefined): string {
  return inferredDay == null
    ? 'Automatic (none found)'
    : `Automatic (${ordinal(inferredDay)})`
}

export function releaseLagLabel(
  inferredLag: number | null | undefined,
): string {
  const lag = inferredLag ?? DEFAULT_RELEASE_LAG
  if (lag === 0) return 'Automatic (same day)'
  return `Automatic (${lag} ${lag === 1 ? 'day' : 'days'})`
}

export function exportModeLabel(
  inferredMode: CoverageExportMode | null | undefined,
): string {
  const mode = inferredMode ?? DEFAULT_MODE
  return mode === 'cycle'
    ? 'Automatic (statement cycle)'
    : 'Automatic (any date range)'
}

/**
 * What to PATCH for a change to the mode or the cycle day — or why it cannot be sent yet.
 *
 * The two travel together because the route validates them together. Switching to a statement
 * cycle when neither a pin nor inference supplies a day is not an error to surface after the
 * round trip; it is a choice the user has not finished making, so the day field is revealed
 * and the commit waits for it.
 *
 * `AUTOMATIC` on either field becomes an explicit `null`, which is how the route is told to
 * drop that override rather than leave it alone.
 */
export function planCycleCommit(
  draft: { mode: ModeChoice; day: DayChoice },
  inferred: Inference,
): CycleCommit {
  const effectiveMode =
    draft.mode === AUTOMATIC ? (inferred.mode ?? DEFAULT_MODE) : draft.mode
  const effectiveDay = draft.day === AUTOMATIC ? inferred.day : draft.day

  if (effectiveMode === 'cycle' && effectiveDay == null) {
    return {
      status: 'incomplete',
      reason: 'Pick the day the statement closes.',
    }
  }

  return {
    status: 'send',
    patch: {
      exportMode: draft.mode === AUTOMATIC ? null : draft.mode,
      cycleDay: draft.day === AUTOMATIC ? null : draft.day,
    },
  }
}
