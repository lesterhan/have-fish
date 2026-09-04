import { describe, it, expect } from 'bun:test'
import {
  comparisonBlocker,
  isFloor,
  monthNote,
  type MonthCoverage,
  type MonthGap,
} from './coverage'

const TODAY = '2026-09-04'
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const labelOf = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

function gap(path: string, coveredThrough: string | null): MonthGap {
  return { accountId: path, path, name: null, coveredThrough }
}

function month(over: Partial<MonthCoverage> & { month: string }): MonthCoverage {
  const [y, m] = over.month.split('-').map(Number)
  const end = `${over.month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  return {
    state: 'complete',
    completeThrough: end,
    through: end,
    contributors: 2,
    gaps: [],
    ...over,
  }
}

const complete = (key: string) => month({ month: key })
const partial = (key: string, through: string | null, gaps: MonthGap[] = [gap('assets:visa', through)]) =>
  month({ month: key, state: 'partial', completeThrough: through, gaps })
const uncovered = (key: string) =>
  month({ month: key, state: 'uncovered', completeThrough: null, gaps: [gap('assets:visa', null)] })

describe('isFloor', () => {
  it('is false for a fully recorded month', () => {
    expect(isFloor(complete('2026-08'))).toBe(false)
  })

  it('is true for a partly recorded month', () => {
    expect(isFloor(partial('2026-08', '2026-08-10'))).toBe(true)
  })

  it('is true for an unrecorded month', () => {
    expect(isFloor(uncovered('2026-08'))).toBe(true)
  })

  // Nothing live contributes, so there is nothing the total could be short of.
  it('is false when there are no contributors', () => {
    expect(isFloor(month({ month: '2026-08', state: 'uncovered', contributors: 0 }))).toBe(false)
  })
})

describe('monthNote', () => {
  it('says nothing when there are no contributors', () => {
    expect(monthNote(month({ month: '2026-08', contributors: 0 }), TODAY)).toBeNull()
  })

  // The month label is already the date, so a past complete month needs no second one.
  it('calls a finished month fully recorded without repeating its dates', () => {
    const result = monthNote(complete('2026-08'), TODAY)

    expect(result?.text).toBe('fully recorded')
    expect(result?.current).toBe(true)
  })

  // "Fully recorded" would claim days that have not happened.
  it('dates the month in progress to today', () => {
    const result = monthNote(
      month({ month: '2026-09', completeThrough: TODAY, through: TODAY }),
      TODAY,
    )

    expect(result?.text).toBe('recorded through today')
  })

  it('marks a partly recorded month as a floor and dates it', () => {
    const result = monthNote(partial('2026-08', '2026-08-10'), TODAY)

    expect(result?.text).toBe('recorded through Aug 10 — at least this much')
    expect(result?.current).toBe(false)
  })

  // A month-wide date needs every contributor to cover the first of the month. One that does
  // not drops it to null however well the others did, so the count takes the date's place
  // rather than the line collapsing to "partly recorded".
  it('counts the unrecorded accounts when there is no month-wide date', () => {
    const result = monthNote(
      partial('2026-08', null, [gap('assets:a', null), gap('assets:b', null)]),
      TODAY,
    )

    expect(result?.text).toBe('at least this much — 2 accounts unrecorded')
  })

  it('agrees its verb with a single unrecorded account', () => {
    const result = monthNote(
      partial('2026-08', null, [gap('assets:a', null), gap('assets:b', '2026-08-20')]),
      TODAY,
    )

    expect(result?.text).toBe('at least this much — 1 account unrecorded')
  })

  it('says an unrecorded month is not recorded', () => {
    const result = monthNote(uncovered('2026-08'), TODAY)

    expect(result?.text).toBe('not recorded')
    expect(result?.detail).toContain('Catch Up')
  })

  it('names the accounts that fall short, and where they stop', () => {
    const result = monthNote(
      partial('2026-08', '2026-08-10', [
        gap('assets:chequing', '2026-08-10'),
        gap('liabilities:visa', null),
      ]),
      TODAY,
    )

    expect(result?.detail).toContain('assets:chequing stops at Aug 10')
    expect(result?.detail).toContain('liabilities:visa is not recorded from the 1st')
  })

  it('prefers an account name over its path', () => {
    const named: MonthGap = {
      accountId: 'a', path: 'assets:bank:chequing', name: 'Everyday', coveredThrough: null,
    }

    expect(monthNote(partial('2026-08', '2026-08-10', [named]), TODAY)?.detail).toContain(
      'Everyday is not recorded from the 1st',
    )
  })

  // A title attribute listing eleven account paths is a wall, not an explanation.
  it('caps the named accounts and counts the rest', () => {
    const gaps = ['a', 'b', 'c', 'd', 'e'].map((p) => gap(`assets:${p}`, null))

    expect(monthNote(partial('2026-08', null, gaps), TODAY)?.detail).toContain('and 2 more')
  })
})

describe('comparisonBlocker', () => {
  it('lets the comparison through when both sides are fully recorded', () => {
    expect(comparisonBlocker(complete('2026-08'), [complete('2026-07')], labelOf)).toBeNull()
  })

  it('blocks on the month being looked at', () => {
    const result = comparisonBlocker(partial('2026-08', '2026-08-10'), [complete('2026-07')], labelOf)

    expect(result?.text).toBe('August 2026 is only partly recorded')
  })

  it('says so plainly when the month being looked at is not recorded at all', () => {
    const result = comparisonBlocker(uncovered('2026-08'), [complete('2026-07')], labelOf)

    expect(result?.text).toBe('August 2026 has not been recorded')
  })

  it('blocks on a prior month when the current one is fine', () => {
    const result = comparisonBlocker(complete('2026-08'), [partial('2026-07', '2026-07-04')], labelOf)

    expect(result?.text).toBe('July 2026 is only partly recorded')
  })

  // Naming a prior month while the month on screen is also incomplete buries the lede: the
  // one the user can act on is the one they are looking at.
  it('names the current month first when both are incomplete', () => {
    const result = comparisonBlocker(
      partial('2026-08', '2026-08-10'),
      [partial('2026-07', null)],
      labelOf,
    )

    expect(result?.text).toBe('August 2026 is only partly recorded')
  })

  it('counts rather than lists when several priors block', () => {
    const result = comparisonBlocker(
      complete('2026-08'),
      [partial('2026-07', null), uncovered('2026-06'), complete('2026-05')],
      labelOf,
    )

    expect(result?.text).toBe('2 of the months compared are only partly recorded')
    expect(result?.detail).toContain('July 2026, June 2026')
  })

  it('does not block on a month with no contributors', () => {
    const empty = month({ month: '2026-07', state: 'uncovered', contributors: 0 })

    expect(comparisonBlocker(complete('2026-08'), [empty], labelOf)).toBeNull()
  })

  it('does not block when a prior month is simply missing from the payload', () => {
    expect(comparisonBlocker(complete('2026-08'), [], labelOf)).toBeNull()
  })
})
