import { describe, it, expect } from 'bun:test'
import { statusLine } from './statusLine'

const iv = (fromDate: string, throughDate: string) => ({ fromDate, throughDate })

describe('statusLine', () => {
  it('says nothing is recorded when there are no intervals', () => {
    const r = statusLine({ intervals: [], horizon: '2026-08-27', nextHorizon: null })
    expect(r.text).toBe('Nothing recorded yet')
    expect(r.daysOpen).toBe(0)
  })

  it('reads as current when coverage reaches the horizon', () => {
    const r = statusLine({
      intervals: [iv('2026-06-01', '2026-08-27')],
      horizon: '2026-08-27',
      nextHorizon: null,
    })
    expect(r.text).toBe('Current')
    expect(r.daysOpen).toBe(0)
  })

  it('names the next statement on a cycle account so current does not look stalled', () => {
    const r = statusLine({
      intervals: [iv('2026-06-01', '2026-07-25')],
      horizon: '2026-07-25',
      nextHorizon: '2026-08-25',
    })
    expect(r.text).toBe('Current · next statement 2026-08-25')
    expect(r.daysOpen).toBe(0)
  })

  it('stays current when coverage runs past the horizon', () => {
    // Coverage asserted beyond what the bank has published yet is still "current",
    // not a negative gap.
    const r = statusLine({
      intervals: [iv('2026-06-01', '2026-09-05')],
      horizon: '2026-08-27',
      nextHorizon: null,
    })
    expect(r.text).toBe('Current')
    expect(r.daysOpen).toBe(0)
  })

  it('counts the open days from the day after the last covered one', () => {
    const r = statusLine({
      intervals: [iv('2026-05-01', '2026-06-20')],
      horizon: '2026-08-27',
      nextHorizon: null,
    })
    expect(r.daysOpen).toBe(68)
    expect(r.text).toBe('Covered through 2026-06-20 · 68 days open')
  })

  it('says "day", singular, for a one-day gap', () => {
    const r = statusLine({
      intervals: [iv('2026-05-01', '2026-08-26')],
      horizon: '2026-08-27',
      nextHorizon: null,
    })
    expect(r.daysOpen).toBe(1)
    expect(r.text).toBe('Covered through 2026-08-26 · 1 day open')
  })

  it('reads the newest interval, which is the one at the head of the list', () => {
    const r = statusLine({
      intervals: [iv('2026-07-01', '2026-07-31'), iv('2026-05-01', '2026-05-31')],
      horizon: '2026-08-27',
      nextHorizon: null,
    })
    expect(r.text).toBe('Covered through 2026-07-31 · 27 days open')
  })
})
