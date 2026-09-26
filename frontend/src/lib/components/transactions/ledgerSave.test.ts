import { describe, expect, it } from 'bun:test'
import { type LedgerDraftPosting, planLedgerSave, postingsChanged } from './ledgerSave'
import type { Posting } from './transactionUtils'

const original: Posting[] = [
  { id: 'p1', accountId: 'cash', amount: '-10.00', currency: 'CAD' },
  { id: 'p2', accountId: 'food', amount: '10.00', currency: 'CAD' },
]

const rows = (overrides: Partial<Record<string, Partial<LedgerDraftPosting>>> = {}) =>
  original.map((p) => ({ ...p, markedForDelete: false, isNew: false, ...overrides[p.id] }))

const header = { date: '2026-02-01', description: 'Lunch' }

describe('postingsChanged', () => {
  it('is false for untouched rows', () => {
    expect(postingsChanged(original, rows())).toBe(false)
  })

  it.each([
    ['account', { accountId: 'dining' }],
    ['amount', { amount: '-12.00' }],
    ['currency', { currency: 'USD' }],
  ])('is true when a row changes its %s', (_, change) => {
    expect(postingsChanged(original, rows({ p1: change }))).toBe(true)
  })

  it('is true when a row is marked for removal', () => {
    expect(postingsChanged(original, rows({ p2: { markedForDelete: true } }))).toBe(true)
  })

  it('is true when a row is added', () => {
    const added = { id: 'new-0', accountId: 'tip', amount: '0.00', currency: 'CAD' }
    expect(
      postingsChanged(original, [...rows(), { ...added, isNew: true, markedForDelete: false }]),
    ).toBe(true)
  })

  it('is false when a row is added and removed again', () => {
    const added = { id: 'new-0', accountId: 'tip', amount: '0.00', currency: 'CAD' }
    expect(
      postingsChanged(original, [...rows(), { ...added, isNew: true, markedForDelete: true }]),
    ).toBe(false)
  })
})

describe('planLedgerSave', () => {
  it('plans nothing when nothing changed', () => {
    expect(
      planLedgerSave({ ...header, postings: original }, { ...header, postings: rows() }),
    ).toEqual({ postings: null, patch: null })
  })

  it('sends the whole posting set, in order, when one leg changes', () => {
    const plan = planLedgerSave(
      { ...header, postings: original },
      { ...header, postings: rows({ p1: { amount: '-12.00' }, p2: { amount: '12.00' } }) },
    )
    expect(plan.postings).toEqual([
      { accountId: 'cash', amount: '-12.00', currency: 'CAD' },
      { accountId: 'food', amount: '12.00', currency: 'CAD' },
    ])
    expect(plan.patch).toBeNull()
  })

  it('leaves removed rows out and new rows in', () => {
    const plan = planLedgerSave(
      { ...header, postings: original },
      {
        ...header,
        postings: [
          ...rows({ p2: { markedForDelete: true } }),
          {
            id: 'new-0',
            accountId: 'dining',
            amount: '10.00',
            currency: 'CAD',
            isNew: true,
            markedForDelete: false,
          },
          {
            id: 'new-1',
            accountId: 'tip',
            amount: '5.00',
            currency: 'CAD',
            isNew: true,
            markedForDelete: true,
          },
        ],
      },
    )
    expect(plan.postings).toEqual([
      { accountId: 'cash', amount: '-10.00', currency: 'CAD' },
      { accountId: 'dining', amount: '10.00', currency: 'CAD' },
    ])
  })

  it('patches only the header fields that changed', () => {
    expect(
      planLedgerSave(
        { ...header, postings: original },
        { ...header, date: '2026-02-02', postings: rows() },
      ),
    ).toEqual({ postings: null, patch: { date: '2026-02-02' } })
  })

  it('clears the description to null when it is emptied', () => {
    expect(
      planLedgerSave(
        { ...header, postings: original },
        { ...header, description: '', postings: rows() },
      ).patch,
    ).toEqual({ description: null })
  })
})
