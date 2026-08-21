import { describe, it, expect } from 'bun:test'
import { addDays, mergeCoverage } from './intervals'

// Shorthand so the cases below read as ranges rather than object literals.
const iv = (fromDate: string, throughDate: string) => ({ fromDate, throughDate })

describe('addDays', () => {
  it('advances within a month', () => {
    expect(addDays('2025-07-10', 1)).toBe('2025-07-11')
  })

  it('rolls over a month boundary', () => {
    expect(addDays('2025-06-30', 1)).toBe('2025-07-01')
  })

  it('rolls over a year boundary', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
  })

  it('handles February in a leap year', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
  })

  it('handles February in a non-leap year', () => {
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
  })

  it('goes backwards with a negative count', () => {
    expect(addDays('2025-07-01', -1)).toBe('2025-06-30')
  })
})

describe('mergeCoverage', () => {
  it('returns an empty array for no input', () => {
    expect(mergeCoverage([])).toEqual([])
  })

  it('returns a single interval untouched', () => {
    expect(mergeCoverage([iv('2025-07-01', '2025-07-31')])).toEqual([iv('2025-07-01', '2025-07-31')])
  })

  it('merges overlapping intervals', () => {
    const merged = mergeCoverage([iv('2025-07-01', '2025-07-20'), iv('2025-07-15', '2025-07-31')])
    expect(merged).toEqual([iv('2025-07-01', '2025-07-31')])
  })

  // The case that matters most: consecutive monthly statements are adjacent, not overlapping.
  // Treating them as disjoint would report a phantom gap at every month boundary.
  it('merges adjacent intervals across a month boundary', () => {
    const merged = mergeCoverage([iv('2025-06-01', '2025-06-30'), iv('2025-07-01', '2025-07-31')])
    expect(merged).toEqual([iv('2025-06-01', '2025-07-31')])
  })

  it('merges adjacent intervals across a year boundary', () => {
    const merged = mergeCoverage([iv('2025-12-01', '2025-12-31'), iv('2026-01-01', '2026-01-31')])
    expect(merged).toEqual([iv('2025-12-01', '2026-01-31')])
  })

  it('absorbs a nested interval without shrinking the span', () => {
    const merged = mergeCoverage([iv('2025-07-01', '2025-07-31'), iv('2025-07-10', '2025-07-15')])
    expect(merged).toEqual([iv('2025-07-01', '2025-07-31')])
  })

  it('absorbs an interval nested at the same start date', () => {
    const merged = mergeCoverage([iv('2025-07-01', '2025-07-31'), iv('2025-07-01', '2025-07-05')])
    expect(merged).toEqual([iv('2025-07-01', '2025-07-31')])
  })

  it('collapses exact duplicates', () => {
    const merged = mergeCoverage([iv('2025-07-01', '2025-07-31'), iv('2025-07-01', '2025-07-31')])
    expect(merged).toEqual([iv('2025-07-01', '2025-07-31')])
  })

  it('keeps disjoint intervals separate', () => {
    const merged = mergeCoverage([iv('2025-06-01', '2025-06-30'), iv('2025-08-01', '2025-08-31')])
    expect(merged).toEqual([iv('2025-06-01', '2025-06-30'), iv('2025-08-01', '2025-08-31')])
  })

  // One missing day is a real gap — the adjacency rule must not swallow it.
  it('keeps intervals separated by a single uncovered day', () => {
    const merged = mergeCoverage([iv('2025-07-01', '2025-07-14'), iv('2025-07-16', '2025-07-31')])
    expect(merged).toEqual([iv('2025-07-01', '2025-07-14'), iv('2025-07-16', '2025-07-31')])
  })

  it('merges single-day intervals that sit next to each other', () => {
    const merged = mergeCoverage([iv('2025-07-01', '2025-07-01'), iv('2025-07-02', '2025-07-02')])
    expect(merged).toEqual([iv('2025-07-01', '2025-07-02')])
  })

  it('sorts unordered input before merging', () => {
    const merged = mergeCoverage([
      iv('2025-08-01', '2025-08-31'),
      iv('2025-06-01', '2025-06-30'),
      iv('2025-07-01', '2025-07-31'),
    ])
    expect(merged).toEqual([iv('2025-06-01', '2025-08-31')])
  })

  // Out-of-order imports are the norm: August lands before July does. The merged view has to
  // show the July hole rather than smoothing it over.
  it('reports the hole left by an out-of-order import', () => {
    const merged = mergeCoverage([
      iv('2025-08-01', '2025-08-31'),
      iv('2025-05-01', '2025-06-30'),
    ])
    expect(merged).toEqual([iv('2025-05-01', '2025-06-30'), iv('2025-08-01', '2025-08-31')])
  })

  it('chains a run of overlapping and adjacent intervals into one span', () => {
    const merged = mergeCoverage([
      iv('2025-01-01', '2025-01-31'),
      iv('2025-01-20', '2025-02-15'),
      iv('2025-02-16', '2025-03-31'),
      iv('2025-06-01', '2025-06-30'),
    ])
    expect(merged).toEqual([iv('2025-01-01', '2025-03-31'), iv('2025-06-01', '2025-06-30')])
  })

  // A long span read early must not be closed off by the shorter intervals that follow it.
  it('does not split a long span because of a later shorter one', () => {
    const merged = mergeCoverage([
      iv('2025-01-01', '2025-12-31'),
      iv('2025-03-01', '2025-03-31'),
      iv('2025-09-01', '2025-09-30'),
    ])
    expect(merged).toEqual([iv('2025-01-01', '2025-12-31')])
  })

  it('does not mutate its input', () => {
    const input = [iv('2025-07-01', '2025-07-20'), iv('2025-07-15', '2025-07-31')]
    const snapshot = structuredClone(input)
    mergeCoverage(input)
    expect(input).toEqual(snapshot)
  })
})
