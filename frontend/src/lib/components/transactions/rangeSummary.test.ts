import { describe, it, expect } from 'bun:test'
import { rangeSummary } from './rangeSummary'

describe('rangeSummary', () => {
  it('spells the range out beside the preset label', () => {
    expect(rangeSummary('2026-05-27', '2026-08-27', 16)).toBe(
      'May 27 → Aug 27 · 16 entries',
    )
  })

  it('drops the leading zero on the day', () => {
    expect(rangeSummary('2026-06-05', '2026-06-09', 2)).toBe(
      'Jun 5 → Jun 9 · 2 entries',
    )
  })

  it('agrees with itself in the singular', () => {
    expect(rangeSummary('2026-01-01', '2026-01-31', 1)).toBe(
      'Jan 1 → Jan 31 · 1 entry',
    )
  })

  it('says zero entries rather than going blank', () => {
    expect(rangeSummary('2026-01-01', '2026-01-31', 0)).toBe(
      'Jan 1 → Jan 31 · 0 entries',
    )
  })

  it('abbreviates every month to three letters', () => {
    expect(rangeSummary('2026-09-01', '2026-12-31', 3)).toBe(
      'Sep 1 → Dec 31 · 3 entries',
    )
  })

  it('passes a malformed date through instead of rendering NaN', () => {
    expect(rangeSummary('', '2026-08-27', 1)).toBe(' → Aug 27 · 1 entry')
    expect(rangeSummary('2026-13-01', '2026-08-27', 1)).toBe(
      '2026-13-01 → Aug 27 · 1 entry',
    )
  })
})
