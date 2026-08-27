import { describe, it, expect } from 'bun:test'
import { isSnoozed, tileState } from './tile'
import type { CatchUpPayload, CatchUpSummary } from '$lib/api'

const TODAY = '2025-07-14'

function payload(summary: Partial<CatchUpSummary>, snoozedUntil: string | null = null): CatchUpPayload {
  const current = summary.current ?? 0
  const tracked = summary.tracked ?? 4
  return {
    today: TODAY,
    accounts: [],
    snoozedUntil,
    summary: {
      current,
      behind: summary.behind ?? 0,
      unset: summary.unset ?? 0,
      tracked,
      dormant: summary.dormant ?? 0,
      accountsToCatchUp: summary.accountsToCatchUp ?? 0,
      progress: { current, tracked },
    },
  }
}

describe('tileState', () => {
  it('says nothing before anything has loaded', () => {
    expect(tileState(null, TODAY)).toEqual({ kind: 'hidden' })
  })

  it('says nothing when there is nothing to track', () => {
    expect(tileState(payload({ tracked: 0 }), TODAY).kind).toBe('hidden')
  })

  // Every account would read maximally behind, so the count would be both alarming and
  // meaningless. The coach asks for a starting line on its own page first.
  it('says nothing while any account is unset', () => {
    expect(tileState(payload({ unset: 1, accountsToCatchUp: 3 }), TODAY).kind).toBe('hidden')
  })

  it('counts accounts, never days', () => {
    const state = tileState(payload({ accountsToCatchUp: 4, tracked: 5, current: 1 }), TODAY)

    expect(state).toEqual({ kind: 'behind', label: '4 accounts to catch up', accounts: 4 })
  })

  it('singularises one account', () => {
    expect(tileState(payload({ accountsToCatchUp: 1 }), TODAY)).toMatchObject({
      label: '1 account to catch up',
    })
  })

  it('reports the finish line when nothing is behind', () => {
    expect(tileState(payload({ accountsToCatchUp: 0, current: 4, tracked: 4 }), TODAY)).toEqual({
      kind: 'current',
      label: 'Ledger current',
    })
  })

  describe('snooze', () => {
    it('hides the ask while in force', () => {
      expect(tileState(payload({ accountsToCatchUp: 4 }, '2025-07-20'), TODAY).kind).toBe('hidden')
    })

    it('returns on the day it expires', () => {
      expect(tileState(payload({ accountsToCatchUp: 4 }, TODAY), TODAY).kind).toBe('behind')
    })

    it('returns after it expires', () => {
      expect(tileState(payload({ accountsToCatchUp: 4 }, '2025-07-01'), TODAY).kind).toBe('behind')
    })

    // Suppressing a finish line the user earned would be a strange way to honour a request
    // for less noise.
    it('silences the ask but not the good news', () => {
      const state = tileState(payload({ accountsToCatchUp: 0, current: 4, tracked: 4 }, '2025-07-20'), TODAY)

      expect(state).toEqual({ kind: 'current', label: 'Ledger current' })
    })

    it('still says nothing while unset, snoozed or not', () => {
      expect(tileState(payload({ unset: 2 }, '2025-07-20'), TODAY).kind).toBe('hidden')
    })
  })
})

describe('isSnoozed', () => {
  it('is false with no snooze', () => {
    expect(isSnoozed(null, TODAY)).toBe(false)
  })

  it('is true while the date is ahead', () => {
    expect(isSnoozed('2025-07-15', TODAY)).toBe(true)
  })

  it('is false on the day itself', () => {
    expect(isSnoozed(TODAY, TODAY)).toBe(false)
  })

  it('is false once past', () => {
    expect(isSnoozed('2025-07-13', TODAY)).toBe(false)
  })
})
