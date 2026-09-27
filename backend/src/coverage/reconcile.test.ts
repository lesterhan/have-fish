import { describe, expect, it } from 'bun:test'
import { coveredThrough, reconcileInterval } from './reconcile'

describe('coveredThrough', () => {
  it('is the last day any assertion reaches, whatever order they come in', () => {
    expect(
      coveredThrough([
        { fromDate: '2026-03-01', throughDate: '2026-03-31' },
        { fromDate: '2026-01-01', throughDate: '2026-01-31' },
      ]),
    ).toBe('2026-03-31')
  })

  it('is null with no assertions', () => {
    expect(coveredThrough([])).toBeNull()
  })
})

describe('reconcileInterval', () => {
  it('continues from the day after coverage stops', () => {
    expect(reconcileInterval('2026-03-31', '2026-04-15', '2025-01-01')).toEqual({
      fromDate: '2026-04-01',
      throughDate: '2026-04-15',
    })
  })

  it('records nothing when coverage already reaches the date', () => {
    expect(reconcileInterval('2026-04-15', '2026-04-15', null)).toBeNull()
    expect(reconcileInterval('2026-05-01', '2026-04-15', null)).toBeNull()
  })

  it('starts at the first transaction when there is no coverage', () => {
    expect(reconcileInterval(null, '2026-04-15', '2026-02-03')).toEqual({
      fromDate: '2026-02-03',
      throughDate: '2026-04-15',
    })
  })

  it('speaks only for the date itself with no coverage and no transactions', () => {
    expect(reconcileInterval(null, '2026-04-15', null)).toEqual({
      fromDate: '2026-04-15',
      throughDate: '2026-04-15',
    })
  })

  it('clamps a first transaction after the date rather than inverting the range', () => {
    expect(reconcileInterval(null, '2026-04-15', '2026-05-01')).toEqual({
      fromDate: '2026-04-15',
      throughDate: '2026-04-15',
    })
  })
})
