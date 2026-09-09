// Whether a *period* is recorded, as opposed to how current a total is.
//
// A month asks a different question than a rollup: not "how current is this" but "is this
// period recorded at all". The leading edge cannot answer it — an account covered either side
// of a hole has a recent edge and an unrecorded month inside it — so these come from
// GET /api/coverage/months, which reads the spans themselves.
//
// Split out of `coverage.ts` because the two halves were never one module: they share only
// the sentence type and the date formatter, and the test file for this half has been called
// `monthCoverage.test.ts` since it was written — naming a module that did not exist.

import { formatCompletenessDate, type CompletenessNote } from './coverage'

export type MonthCoverageState = 'complete' | 'partial' | 'uncovered'

export type MonthGap = {
  accountId: string
  path: string
  name: string | null
  // How far into the month this account is recorded, or null when it covers none of it.
  coveredThrough: string | null
}

export type MonthCoverage = {
  month: string
  state: MonthCoverageState
  completeThrough: string | null
  // The month's end, or today for a month still in progress.
  through: string
  contributors: number
  gaps: MonthGap[]
}

// Whether a total over this month is a value or a floor. A month with no live contributors
// has nothing to be complete or incomplete about, so it is not treated as a floor.
export function isFloor(m: MonthCoverage): boolean {
  return m.contributors > 0 && m.state !== 'complete'
}

function accountLabel(gap: MonthGap): string {
  return gap.name ?? gap.path
}

// Up to three named accounts, then a count — a title attribute that lists eleven account
// paths is a wall, not an explanation.
function listGaps(gaps: readonly MonthGap[], today: string): string {
  const shown = gaps.slice(0, 3).map((g) => {
    const label = accountLabel(g)
    // A null prefix means the account is not recorded from the first of the month. It may
    // still hold a mid-month island, which is why this is not "not recorded at all".
    return g.coveredThrough === null
      ? `${label} is not recorded from the 1st`
      : `${label} stops at ${formatCompletenessDate(g.coveredThrough, today)}`
  })
  const rest = gaps.length - shown.length
  return rest > 0 ? `${shown.join('; ')}; and ${rest} more` : shown.join('; ')
}

const unrecorded = (n: number) =>
  `${n} ${n === 1 ? 'account' : 'accounts'} unrecorded`

// What the month's own total is worth, said under the figure. Null when there is nothing to
// say — no live contributors, or a month nobody has lived through yet.
export function monthNote(
  m: MonthCoverage,
  today: string,
): CompletenessNote | null {
  if (m.contributors === 0) return null

  if (m.state === 'complete') {
    // A past month complete to its own end needs no date: the month label is the date. A month
    // still in progress does, because "fully recorded" would claim days that haven't happened.
    // The backend clamps `through` to today only for a month that has not finished.
    const inProgress = m.through === today
    return {
      text: inProgress ? 'recorded through today' : 'fully recorded',
      detail: inProgress
        ? 'Every account is recorded up to today, so this total is complete as far as the month has run.'
        : 'Every account is recorded for the whole month, so this total is the whole of it.',
      current: true,
    }
  }

  if (m.state === 'uncovered') {
    return {
      text: 'not recorded',
      detail:
        `No account is recorded for any part of this month, so whatever is shown here is ` +
        `whatever happens to have been entered by hand. ${listGaps(m.gaps, today)}. ` +
        `Record it in Catch Up.`,
      current: false,
    }
  }

  // A month-wide date exists only when every contributor covers at least the first of the
  // month. One account that doesn't drops it to null however well the others did — and on a
  // real ledger that account is common, so the count takes the date's place rather than the
  // line collapsing to a shrug.
  const through = m.completeThrough
  const missing = m.gaps.filter((g) => g.coveredThrough === null).length

  return {
    text:
      through === null
        ? `at least this much — ${unrecorded(missing)}`
        : `recorded through ${formatCompletenessDate(through, today)} — at least this much`,
    detail:
      (through === null
        ? `Some accounts are not recorded from the first of this month, so the total is a floor rather than a value. `
        : `Recorded through ${formatCompletenessDate(through, today)}; after that it is a floor, not a value. `) +
      `${listGaps(m.gaps, today)}. Record them in Catch Up.`,
    current: false,
  }
}

// Why a comparison is not being drawn, or null when it may be.
//
// §4: a derived comparison is not drawn at all unless both sides are fully covered, because a
// qualified comparison is still read as a fact — the caveat is smaller than the number and
// loses. So this returns the reason to put in the number's place, never beside it.
export function comparisonBlocker(
  current: MonthCoverage,
  priors: readonly MonthCoverage[],
  labelOf: (month: string) => string,
): CompletenessNote | null {
  // The month the user is looking at comes first: it is the one they can act on, and naming a
  // prior month while the current one is also incomplete buries the lede.
  if (isFloor(current)) {
    const label = labelOf(current.month)
    return {
      text:
        current.state === 'uncovered'
          ? `${label} has not been recorded`
          : `${label} is only partly recorded`,
      detail: `No comparison is drawn until both sides are fully recorded. ${label} is not.`,
      current: false,
    }
  }

  const blocking = priors.filter(isFloor)
  if (blocking.length === 0) return null

  const text =
    blocking.length === 1
      ? `${labelOf(blocking[0].month)} is only partly recorded`
      : `${blocking.length} of the months compared are only partly recorded`

  return {
    text,
    detail:
      `No comparison is drawn until both sides are fully recorded. ` +
      `${blocking.map((m) => labelOf(m.month)).join(', ')} ${blocking.length === 1 ? 'is' : 'are'} not.`,
    current: false,
  }
}
