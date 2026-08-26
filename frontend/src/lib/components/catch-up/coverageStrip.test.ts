import { describe, it, expect } from 'bun:test'
import { ariaSummary, buildStrip, describeDay, summarizeStrip, type CoverageDay } from './coverageStrip'

const iv = (fromDate: string, throughDate: string) => ({ fromDate, throughDate })

function strip(over: Partial<Parameters<typeof buildStrip>[0]> = {}) {
  return buildStrip({
    from: '2025-07-01',
    to: '2025-07-10',
    intervals: [],
    horizon: '2025-07-10',
    txnDates: [],
    ...over,
  })
}

const at = (days: CoverageDay[], date: string) => days.find((d) => d.date === date)!

describe('buildStrip', () => {
  it('emits one cell per day, inclusive of both ends', () => {
    const days = strip()

    expect(days).toHaveLength(10)
    expect(days[0].date).toBe('2025-07-01')
    expect(days[9].date).toBe('2025-07-10')
  })

  it('emits a single cell for a one-day window', () => {
    expect(strip({ from: '2025-07-05', to: '2025-07-05' })).toHaveLength(1)
  })

  it('returns nothing for an inverted window', () => {
    expect(strip({ from: '2025-07-10', to: '2025-07-01' })).toEqual([])
  })

  it('spans a month boundary', () => {
    const days = strip({ from: '2025-06-28', to: '2025-07-03', horizon: '2025-07-03' })

    expect(days.map((d) => d.date)).toEqual([
      '2025-06-28', '2025-06-29', '2025-06-30', '2025-07-01', '2025-07-02', '2025-07-03',
    ])
  })

  describe('the four states', () => {
    it('marks days inside an interval covered', () => {
      const days = strip({ intervals: [iv('2025-07-01', '2025-07-04')] })

      expect(at(days, '2025-07-01').state).toBe('covered')
      expect(at(days, '2025-07-04').state).toBe('covered')
      expect(at(days, '2025-07-05').state).toBe('uncovered')
    })

    it('marks days past the horizon as not yet available, not as a gap', () => {
      const days = strip({ horizon: '2025-07-06' })

      expect(at(days, '2025-07-06').state).toBe('uncovered')
      expect(at(days, '2025-07-07').state).toBe('beyond-horizon')
      expect(at(days, '2025-07-10').state).toBe('beyond-horizon')
    })

    // The mixed state this whole feature exists for: a split entered from the phone sitting
    // inside a month that is otherwise unimported.
    it('flags transactions on uncovered days', () => {
      const days = strip({
        intervals: [iv('2025-07-01', '2025-07-03')],
        txnDates: ['2025-07-02', '2025-07-08'],
      })

      expect(at(days, '2025-07-02')).toMatchObject({ state: 'covered', hasTxn: true })
      expect(at(days, '2025-07-08')).toMatchObject({ state: 'uncovered', hasTxn: true })
      expect(at(days, '2025-07-09').hasTxn).toBe(false)
    })

    // Contradicting a fact the user already recorded would be worse than the redundancy.
    it('lets covered win over beyond-horizon', () => {
      const days = strip({ intervals: [iv('2025-07-01', '2025-07-10')], horizon: '2025-07-05' })

      expect(at(days, '2025-07-08').state).toBe('covered')
    })

    it('handles the horizon landing on the last cell', () => {
      const days = strip({ horizon: '2025-07-10' })

      expect(days.every((d) => d.state === 'uncovered')).toBe(true)
    })

    it('handles a horizon before the whole window', () => {
      const days = strip({ horizon: '2025-06-01' })

      expect(days.every((d) => d.state === 'beyond-horizon')).toBe(true)
    })
  })

  describe('coverage shapes', () => {
    it('shows a hole between two disjoint intervals', () => {
      const days = strip({
        intervals: [iv('2025-07-01', '2025-07-03'), iv('2025-07-07', '2025-07-10')],
      })

      expect(days.map((d) => d.state)).toEqual([
        'covered', 'covered', 'covered',
        'uncovered', 'uncovered', 'uncovered',
        'covered', 'covered', 'covered', 'covered',
      ])
    })

    // Consecutive statements leave no uncovered day between them.
    it('shows no seam between adjacent intervals', () => {
      const days = strip({
        from: '2025-06-28', to: '2025-07-03', horizon: '2025-07-03',
        intervals: [iv('2025-06-01', '2025-06-30'), iv('2025-07-01', '2025-07-31')],
      })

      expect(days.every((d) => d.state === 'covered')).toBe(true)
    })

    it('handles coverage extending beyond the window on both sides', () => {
      const days = strip({ intervals: [iv('2020-01-01', '2030-01-01')] })

      expect(days.every((d) => d.state === 'covered')).toBe(true)
    })
  })

  describe('month labels', () => {
    it('labels the first cell of the window', () => {
      expect(strip()[0].monthLabel).toBe('Jul')
    })

    it('labels the first day of each month and nothing else', () => {
      const days = strip({ from: '2025-06-20', to: '2025-08-02', horizon: '2025-08-02' })
      const labelled = days.filter((d) => d.monthLabel !== null)

      expect(labelled.map((d) => [d.date, d.monthLabel])).toEqual([
        ['2025-06-20', 'Jun'],
        ['2025-07-01', 'Jul'],
        ['2025-08-01', 'Aug'],
      ])
    })

    it('does not double-label when the window starts on the first of a month', () => {
      const days = strip({ from: '2025-07-01', to: '2025-07-05', horizon: '2025-07-05' })

      expect(days.filter((d) => d.monthLabel !== null)).toHaveLength(1)
    })

    it('labels across a year boundary', () => {
      const days = strip({ from: '2025-12-20', to: '2026-01-02', horizon: '2026-01-02' })

      expect(days.filter((d) => d.monthLabel).map((d) => d.monthLabel)).toEqual(['Dec', 'Jan'])
    })
  })
})

describe('describeDay', () => {
  const day = (over: Partial<CoverageDay>): CoverageDay => ({
    date: '2025-07-04', state: 'uncovered', hasTxn: false, monthLabel: null, ...over,
  })

  it('names a covered day', () => {
    expect(describeDay(day({ state: 'covered' }))).toBe('2025-07-04 · covered')
  })

  it('names an uncovered day', () => {
    expect(describeDay(day({}))).toBe('2025-07-04 · not covered')
  })

  // "not yet available" rather than anything implying the user is behind on it.
  it('names a day past the horizon as not yet available', () => {
    expect(describeDay(day({ state: 'beyond-horizon' }))).toBe('2025-07-04 · not yet available')
  })

  it('mentions transactions when the day has them', () => {
    expect(describeDay(day({ hasTxn: true }))).toBe('2025-07-04 · not covered · has transactions')
  })
})

describe('summarizeStrip', () => {
  it('counts each state', () => {
    const days = buildStrip({
      from: '2025-07-01',
      to: '2025-07-10',
      intervals: [iv('2025-07-01', '2025-07-04')],
      horizon: '2025-07-08',
      txnDates: ['2025-07-02', '2025-07-06', '2025-07-07'],
    })

    expect(summarizeStrip(days)).toEqual({
      covered: 4,
      uncovered: 4,
      beyondHorizon: 2,
      txnsInUncovered: 2,
    })
  })

  it('is all zeroes for an empty strip', () => {
    expect(summarizeStrip([])).toEqual({
      covered: 0, uncovered: 0, beyondHorizon: 0, txnsInUncovered: 0,
    })
  })
})

describe('ariaSummary', () => {
  it('states the counts as prose', () => {
    expect(ariaSummary({ covered: 40, uncovered: 50, beyondHorizon: 0, txnsInUncovered: 3 }, '2025-04-16', '2025-07-14'))
      .toBe('Coverage from 2025-04-16 to 2025-07-14: 40 covered, 50 not covered.')
  })

  it('mentions the unavailable span only when there is one', () => {
    expect(ariaSummary({ covered: 60, uncovered: 10, beyondHorizon: 20, txnsInUncovered: 0 }, '2025-04-16', '2025-07-14'))
      .toContain('20 not yet available')
  })
})

describe('month label crowding', () => {
  // Two labels a few pixels apart overlap into a smudge — the boundary's own label speaks
  // for both.
  it('drops the leading label when a month starts right after the window opens', () => {
    const days = buildStrip({
      from: '2025-06-29', to: '2025-07-10', intervals: [], horizon: '2025-07-10', txnDates: [],
    })

    expect(days.filter((d) => d.monthLabel).map((d) => [d.date, d.monthLabel])).toEqual([
      ['2025-07-01', 'Jul'],
    ])
  })

  it('keeps the leading label when the next month is far enough away', () => {
    const days = buildStrip({
      from: '2025-06-20', to: '2025-07-10', intervals: [], horizon: '2025-07-10', txnDates: [],
    })

    expect(days.filter((d) => d.monthLabel).map((d) => d.monthLabel)).toEqual(['Jun', 'Jul'])
  })

  it('keeps the leading label when the window ends before the next month', () => {
    const days = buildStrip({
      from: '2025-06-28', to: '2025-06-30', intervals: [], horizon: '2025-06-30', txnDates: [],
    })

    expect(days.filter((d) => d.monthLabel).map((d) => d.monthLabel)).toEqual(['Jun'])
  })

  it('handles a December window rolling into January', () => {
    const days = buildStrip({
      from: '2025-12-29', to: '2026-01-10', intervals: [], horizon: '2026-01-10', txnDates: [],
    })

    expect(days.filter((d) => d.monthLabel).map((d) => d.monthLabel)).toEqual(['Jan'])
  })
})
