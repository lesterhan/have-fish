import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_CONFIG,
  dateInMonth,
  daysInMonth,
  horizon,
  inferCycleFromIntervals,
  mergeConfig,
  nextHorizon,
  type CoverageConfig,
} from './horizon'

// A cycle account, spelled out per case so each test reads as its own scenario.
const cycle = (cycleDay: number, releaseLag = 0): CoverageConfig => ({
  exportMode: 'cycle',
  cycleDay,
  releaseLag,
  tracked: true,
})

const iv = (fromDate: string, throughDate: string) => ({ fromDate, throughDate })

describe('daysInMonth', () => {
  it('knows the long and short months', () => {
    expect(daysInMonth(2025, 1)).toBe(31)
    expect(daysInMonth(2025, 4)).toBe(30)
    expect(daysInMonth(2025, 12)).toBe(31)
  })

  it('knows February in leap and non-leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2025, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
  })
})

describe('dateInMonth', () => {
  it('formats a normal day', () => {
    expect(dateInMonth(2025, 7, 25)).toBe('2025-07-25')
  })

  it('zero-pads month and day', () => {
    expect(dateInMonth(2025, 3, 5)).toBe('2025-03-05')
  })

  // This clamp is what lets cycleDay 31 mean "month end" rather than spilling into March.
  it('clamps day 31 to the end of a short month', () => {
    expect(dateInMonth(2025, 2, 31)).toBe('2025-02-28')
    expect(dateInMonth(2024, 2, 31)).toBe('2024-02-29')
    expect(dateInMonth(2025, 4, 31)).toBe('2025-04-30')
  })

  it('leaves day 31 alone in a long month', () => {
    expect(dateInMonth(2025, 1, 31)).toBe('2025-01-31')
  })
})

describe('horizon', () => {
  it('is today for a range account', () => {
    expect(horizon(DEFAULT_CONFIG, '2025-07-14')).toBe('2025-07-14')
  })

  // The three days around a cycle close: the statement only becomes the horizon on the day
  // it closes, and stays the horizon until the next one does.
  it('is last month the day before the cycle closes', () => {
    expect(horizon(cycle(25), '2025-07-24')).toBe('2025-06-25')
  })

  it('advances on the day the cycle closes', () => {
    expect(horizon(cycle(25), '2025-07-25')).toBe('2025-07-25')
  })

  it('holds the day after the cycle closes', () => {
    expect(horizon(cycle(25), '2025-07-26')).toBe('2025-07-25')
  })

  // A statement that has closed but not been released is not obtainable, so the horizon stays
  // a full cycle back until the lag elapses.
  it('waits out the release lag before advancing', () => {
    // The Jul 25 close is downloadable on Jul 28, so the horizon is still June until then.
    expect(horizon(cycle(25, 3), '2025-07-26')).toBe('2025-06-25')
    expect(horizon(cycle(25, 3), '2025-07-27')).toBe('2025-06-25')
    expect(horizon(cycle(25, 3), '2025-07-28')).toBe('2025-07-25')
    expect(horizon(cycle(25, 3), '2025-07-29')).toBe('2025-07-25')
  })

  it('walks back across a year boundary', () => {
    expect(horizon(cycle(25), '2025-01-10')).toBe('2024-12-25')
  })

  it('clamps a day-31 cycle to the end of February', () => {
    expect(horizon(cycle(31), '2025-03-01')).toBe('2025-02-28')
    expect(horizon(cycle(31), '2024-03-01')).toBe('2024-02-29')
  })

  it('resolves a day-31 cycle to month end all year', () => {
    expect(horizon(cycle(31), '2025-05-01')).toBe('2025-04-30')
    expect(horizon(cycle(31), '2025-07-31')).toBe('2025-07-31')
  })

  it('handles a cycle on the 1st', () => {
    expect(horizon(cycle(1), '2025-07-01')).toBe('2025-07-01')
    expect(horizon(cycle(1), '2025-06-30')).toBe('2025-06-01')
  })

  // Falling back to today over-reports rather than inventing a cycle boundary — the safe
  // direction, since an over-reported gap costs a click and an under-reported one hides data.
  it('falls back to today when a cycle account has no cycle day', () => {
    expect(horizon({ ...DEFAULT_CONFIG, exportMode: 'cycle' }, '2025-07-14')).toBe('2025-07-14')
  })
})

describe('nextHorizon', () => {
  it('is null for a range account', () => {
    expect(nextHorizon(DEFAULT_CONFIG, '2025-07-14')).toBeNull()
  })

  it('is the upcoming close when this month has not closed yet', () => {
    expect(nextHorizon(cycle(25), '2025-07-24')).toBe('2025-07-25')
  })

  it('is next month once this month has closed', () => {
    expect(nextHorizon(cycle(25), '2025-07-26')).toBe('2025-08-25')
  })

  it('rolls over a year boundary', () => {
    expect(nextHorizon(cycle(25), '2025-12-26')).toBe('2026-01-25')
  })

  it('clamps the next close to a short month', () => {
    expect(nextHorizon(cycle(31), '2025-02-01')).toBe('2025-02-28')
  })
})

describe('inferCycleFromIntervals', () => {
  it('declines on no intervals', () => {
    expect(inferCycleFromIntervals([])).toBeNull()
  })

  // Two monthly statements are a coincidence; three are a rhythm.
  it('declines on two intervals', () => {
    expect(inferCycleFromIntervals([
      iv('2025-05-26', '2025-06-25'),
      iv('2025-06-26', '2025-07-25'),
    ])).toBeNull()
  })

  it('infers a mid-month cycle day from three statements', () => {
    expect(inferCycleFromIntervals([
      iv('2025-04-26', '2025-05-25'),
      iv('2025-05-26', '2025-06-25'),
      iv('2025-06-26', '2025-07-25'),
    ])).toEqual({ exportMode: 'cycle', cycleDay: 25 })
  })

  // Month-end statements land on 31, 30, 28 or 29, so they agree on "last day" rather than on
  // a number. cycleDay 31 is how that is stored.
  it('infers month-end statements as day 31', () => {
    expect(inferCycleFromIntervals([
      iv('2025-01-01', '2025-01-31'),
      iv('2025-02-01', '2025-02-28'),
      iv('2025-03-01', '2025-03-31'),
      iv('2025-04-01', '2025-04-30'),
    ])).toEqual({ exportMode: 'cycle', cycleDay: 31 })
  })

  it('infers month-end across a leap February', () => {
    expect(inferCycleFromIntervals([
      iv('2024-01-01', '2024-01-31'),
      iv('2024-02-01', '2024-02-29'),
      iv('2024-03-01', '2024-03-31'),
    ])).toEqual({ exportMode: 'cycle', cycleDay: 31 })
  })

  // Ad-hoc range exports that happen to share a day of month are not a statement cycle.
  it('declines when the intervals are not roughly a month apart', () => {
    expect(inferCycleFromIntervals([
      iv('2025-01-01', '2025-01-15'),
      iv('2025-01-16', '2025-02-15'),
      iv('2025-02-16', '2025-08-15'),
    ])).toBeNull()
  })

  it('declines when the end dates disagree on a day', () => {
    expect(inferCycleFromIntervals([
      iv('2025-04-26', '2025-05-20'),
      iv('2025-05-21', '2025-06-17'),
      iv('2025-06-18', '2025-07-14'),
    ])).toBeNull()
  })

  it('declines on weekly intervals', () => {
    expect(inferCycleFromIntervals([
      iv('2025-07-01', '2025-07-07'),
      iv('2025-07-08', '2025-07-14'),
      iv('2025-07-15', '2025-07-21'),
    ])).toBeNull()
  })

  it('reads the rhythm regardless of input order', () => {
    expect(inferCycleFromIntervals([
      iv('2025-05-26', '2025-06-25'),
      iv('2025-06-26', '2025-07-25'),
      iv('2025-04-26', '2025-05-25'),
    ])).toEqual({ exportMode: 'cycle', cycleDay: 25 })
  })

  // Only the most recent statements are sampled, so a cycle day the bank changed a year ago
  // cannot outvote the one in force now.
  it('judges on the most recent statements when the cycle day changed', () => {
    expect(inferCycleFromIntervals([
      iv('2024-08-11', '2024-09-10'),
      iv('2024-09-11', '2024-10-10'),
      iv('2024-10-11', '2024-11-10'),
      iv('2025-02-26', '2025-03-25'),
      iv('2025-03-26', '2025-04-25'),
      iv('2025-04-26', '2025-05-25'),
      iv('2025-05-26', '2025-06-25'),
      iv('2025-06-26', '2025-07-25'),
      iv('2025-07-26', '2025-08-25'),
    ])).toEqual({ exportMode: 'cycle', cycleDay: 25 })
  })

  it('never infers a release lag', () => {
    const inferred = inferCycleFromIntervals([
      iv('2025-04-26', '2025-05-25'),
      iv('2025-05-26', '2025-06-25'),
      iv('2025-06-26', '2025-07-25'),
    ])
    expect(inferred).not.toHaveProperty('releaseLag')
  })
})

describe('mergeConfig', () => {
  it('is the defaults when nothing is known', () => {
    expect(mergeConfig(null, {})).toEqual(DEFAULT_CONFIG)
  })

  it('defaults to range, which puts the horizon at today', () => {
    expect(DEFAULT_CONFIG.exportMode).toBe('range')
    expect(horizon(mergeConfig(null, {}), '2025-07-14')).toBe('2025-07-14')
  })

  it('applies inference over the defaults', () => {
    expect(mergeConfig({ exportMode: 'cycle', cycleDay: 25 }, {})).toEqual({
      exportMode: 'cycle', cycleDay: 25, releaseLag: 0, tracked: true,
    })
  })

  it('lets the override beat inference', () => {
    expect(mergeConfig({ exportMode: 'cycle', cycleDay: 25 }, { cycleDay: 18 })).toEqual({
      exportMode: 'cycle', cycleDay: 18, releaseLag: 0, tracked: true,
    })
  })

  it('lets an override turn an inferred cycle account back into a range account', () => {
    const config = mergeConfig({ exportMode: 'cycle', cycleDay: 25 }, { exportMode: 'range' })
    expect(horizon(config, '2025-07-14')).toBe('2025-07-14')
  })

  it('carries an override for a field inference never sets', () => {
    expect(mergeConfig(null, { releaseLag: 3, tracked: false })).toEqual({
      exportMode: 'range', cycleDay: null, releaseLag: 3, tracked: false,
    })
  })
})
