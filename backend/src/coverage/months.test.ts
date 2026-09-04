import { describe, it, expect } from 'bun:test'
import {
  classifyMonth,
  classifyMonths,
  monthBounds,
  monthsBetween,
  type MonthCoverageInput,
} from './months'
import { mergeCoverage } from './intervals'

const TODAY = '2026-09-04'

function account(
  accountId: string,
  spans: [string, string][],
  dormant = false,
): MonthCoverageInput {
  return {
    accountId,
    path: `assets:${accountId}`,
    name: null,
    intervals: mergeCoverage(spans.map(([fromDate, throughDate]) => ({ fromDate, throughDate }))),
    dormant,
  }
}

describe('monthBounds', () => {
  it('runs a past month to its own end', () => {
    expect(monthBounds('2026-08', TODAY)).toEqual({ from: '2026-08-01', through: '2026-08-31' })
  })

  // September cannot be behind on days that have not happened.
  it('clamps the month in progress to today', () => {
    expect(monthBounds('2026-09', TODAY)).toEqual({ from: '2026-09-01', through: TODAY })
  })

  it('gets February right in a leap year', () => {
    expect(monthBounds('2028-02', '2028-06-01').through).toBe('2028-02-29')
  })

  it('gets February right outside one', () => {
    expect(monthBounds('2026-02', TODAY).through).toBe('2026-02-28')
  })
})

describe('monthsBetween', () => {
  it('walks an inclusive range', () => {
    expect(monthsBetween('2026-07', '2026-09')).toEqual(['2026-07', '2026-08', '2026-09'])
  })

  it('crosses a year boundary', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('returns the one month when from equals to', () => {
    expect(monthsBetween('2026-09', '2026-09')).toEqual(['2026-09'])
  })

  it('returns nothing for an inverted range', () => {
    expect(monthsBetween('2026-09', '2026-07')).toEqual([])
  })
})

describe('classifyMonth', () => {
  it('calls a month complete when every contributor covers all of it', () => {
    const result = classifyMonth(
      [account('a', [['2026-01-01', '2026-12-31']]), account('b', [['2026-08-01', '2026-08-31']])],
      '2026-08',
      TODAY,
    )

    expect(result.state).toBe('complete')
    expect(result.completeThrough).toBe('2026-08-31')
    expect(result.gaps).toEqual([])
    expect(result.contributors).toBe(2)
  })

  it('calls it partial when one contributor stops inside it', () => {
    const result = classifyMonth(
      [account('a', [['2026-01-01', '2026-12-31']]), account('b', [['2026-01-01', '2026-08-10']])],
      '2026-08',
      TODAY,
    )

    expect(result.state).toBe('partial')
    expect(result.completeThrough).toBe('2026-08-10')
    expect(result.gaps).toEqual([
      { accountId: 'b', path: 'assets:b', name: null, coveredThrough: '2026-08-10' },
    ])
  })

  it('takes the weakest contributor as the month completeness date', () => {
    const result = classifyMonth(
      [
        account('a', [['2026-01-01', '2026-08-20']]),
        account('b', [['2026-01-01', '2026-08-03']]),
        account('c', [['2026-01-01', '2026-12-31']]),
      ],
      '2026-08',
      TODAY,
    )

    expect(result.completeThrough).toBe('2026-08-03')
    expect(result.gaps.map((g) => g.accountId)).toEqual(['a', 'b'])
  })

  // The trap the leading edge alone falls into: an account covered either side of a hole has
  // a leading edge in September and says nothing about whether July is recorded.
  it('sees a hole that the leading edge hides', () => {
    const result = classifyMonth(
      [account('a', [['2026-01-01', '2026-06-30'], ['2026-08-01', '2026-09-04']])],
      '2026-07',
      TODAY,
    )

    expect(result.state).toBe('uncovered')
    expect(result.completeThrough).toBeNull()
  })

  it('reports a mid-month island as partial, not complete', () => {
    const result = classifyMonth([account('a', [['2026-08-10', '2026-08-20']])], '2026-08', TODAY)

    expect(result.state).toBe('partial')
    // The prefix from the first of the month, not the island — Aug 1-9 is missing.
    expect(result.completeThrough).toBeNull()
    expect(result.gaps[0].coveredThrough).toBeNull()
  })

  it('calls it uncovered when nothing touches the month at all', () => {
    const result = classifyMonth([account('a', [['2026-01-01', '2026-03-31']])], '2026-08', TODAY)

    expect(result.state).toBe('uncovered')
    expect(result.gaps).toHaveLength(1)
  })

  it('treats an account with no coverage at all as covering none of it', () => {
    const result = classifyMonth([account('a', [])], '2026-08', TODAY)

    expect(result.state).toBe('uncovered')
    expect(result.gaps[0].coveredThrough).toBeNull()
  })

  // Same rule as a rollup's as-of: an account confirmed empty has nothing to contribute, so
  // being unrecorded for it cannot make the month's total wrong.
  it('does not let a dormant account hold a month back', () => {
    const result = classifyMonth(
      [account('a', [['2026-01-01', '2026-12-31']]), account('b', [], true)],
      '2026-08',
      TODAY,
    )

    expect(result.state).toBe('complete')
    expect(result.contributors).toBe(1)
  })

  it('measures the month in progress against today, not its end', () => {
    const result = classifyMonth([account('a', [['2026-01-01', TODAY]])], '2026-09', TODAY)

    expect(result.state).toBe('complete')
    expect(result.completeThrough).toBe(TODAY)
  })

  it('still catches a shortfall inside the month in progress', () => {
    const result = classifyMonth([account('a', [['2026-01-01', '2026-09-02']])], '2026-09', TODAY)

    expect(result.state).toBe('partial')
    expect(result.completeThrough).toBe('2026-09-02')
  })

  // A month nobody has lived through yet is not unrecorded, and no caller should describe it.
  it('reports no contributors for a month that has not started', () => {
    const result = classifyMonth([account('a', [['2026-01-01', TODAY]])], '2026-11', TODAY)

    expect(result.contributors).toBe(0)
    expect(result.gaps).toEqual([])
  })

  it('reports no contributors when every account is dormant', () => {
    const result = classifyMonth([account('a', [], true)], '2026-08', TODAY)

    expect(result.contributors).toBe(0)
    expect(result.state).toBe('complete')
  })
})

describe('classifyMonths', () => {
  it('classifies each month independently', () => {
    const accounts = [account('a', [['2026-06-01', '2026-07-15']])]

    const [june, july, august] = classifyMonths(accounts, ['2026-06', '2026-07', '2026-08'], TODAY)

    expect(june.state).toBe('complete')
    expect(july.state).toBe('partial')
    expect(august.state).toBe('uncovered')
  })
})
