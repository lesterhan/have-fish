import { describe, expect, it } from 'bun:test'
import { byAccount, candidateWindow, type ExistingPosting, findDuplicate } from './duplicates'

// No database here: the rule for "probably the same money" on its own.

const existing: ExistingPosting[] = [
  { transactionId: 'lunch', date: '2026-03-10', amount: '-42.50', currency: 'CAD' },
  { transactionId: 'yen', date: '2026-03-10', amount: '-8400.00', currency: 'JPY' },
]

describe('findDuplicate', () => {
  it('matches the same amount on the same day, ignoring sign and currency case', () => {
    expect(
      findDuplicate({ date: '2026-03-10', amount: '42.50', currency: 'cad' }, existing)
        ?.transactionId,
    ).toBe('lunch')
  })

  it('matches within a day either side, and not beyond', () => {
    for (const date of ['2026-03-09', '2026-03-11']) {
      expect(findDuplicate({ date, amount: '-42.50', currency: 'CAD' }, existing)).toBeDefined()
    }
    for (const date of ['2026-03-08', '2026-03-12']) {
      expect(findDuplicate({ date, amount: '-42.50', currency: 'CAD' }, existing)).toBeUndefined()
    }
  })

  it('reads a timestamp by its date, as an older client sends it', () => {
    const row = { date: '2026-03-11T00:00:00.000Z', amount: '-42.50', currency: 'CAD' }
    expect(findDuplicate(row, existing)).toBeDefined()
  })

  it('matches nothing for a row with no real date', () => {
    const row = { date: 'yesterday', amount: '-42.50', currency: 'CAD' }
    expect(findDuplicate(row, existing)).toBeUndefined()
  })

  it('matches within a cent, and not beyond', () => {
    expect(
      findDuplicate({ date: '2026-03-10', amount: '-42.51', currency: 'CAD' }, existing),
    ).toBeDefined()
    expect(
      findDuplicate({ date: '2026-03-10', amount: '-42.52', currency: 'CAD' }, existing),
    ).toBeUndefined()
  })

  // In floats, 18.41 against 18.40 is 0.010000000000001563 and was missed, while 42.51
  // against 42.50 is 0.00999999999999801 and matched.
  it('matches a cent apart whatever the digits', () => {
    for (const [a, b] of [
      ['18.41', '-18.40'],
      ['-18.40', '-18.41'],
      ['0.29', '-0.28'],
      ['1000000.01', '-1000000.00'],
    ] as const) {
      const posting = [{ transactionId: 'p', date: '2026-03-10', amount: b, currency: 'CAD' }]
      expect(
        findDuplicate({ date: '2026-03-10', amount: a, currency: 'CAD' }, posting),
      ).toBeDefined()
    }
  })

  it('matches nothing for an amount that is not one', () => {
    expect(
      findDuplicate({ date: '2026-03-10', amount: 'abc', currency: 'CAD' }, existing),
    ).toBeUndefined()
  })

  it('never matches across currencies: 8,400 JPY is not 8,400 CAD', () => {
    expect(
      findDuplicate({ date: '2026-03-10', amount: '-8400.00', currency: 'CAD' }, existing),
    ).toBeUndefined()
    expect(
      findDuplicate({ date: '2026-03-10', amount: '-8400.00', currency: 'JPY' }, existing)
        ?.transactionId,
    ).toBe('yen')
  })
})

describe('byAccount', () => {
  it('groups rows by account with their positions, and skips transfer rows', () => {
    const grouped = byAccount([
      { accountId: 'a' },
      { accountId: '' },
      { accountId: 'b' },
      { accountId: 'a' },
    ])
    expect([...grouped.keys()]).toEqual(['a', 'b'])
    expect(grouped.get('a')?.map((e) => e.i)).toEqual([0, 3])
    expect(grouped.get('b')?.map((e) => e.i)).toEqual([2])
  })
})

describe('candidateWindow', () => {
  it('reaches a day before the earliest row and a day after the latest', () => {
    expect(candidateWindow(['2026-03-10', '2026-03-05', '2026-03-01T09:00:00Z'])).toEqual({
      from: '2026-02-28',
      to: '2026-03-11',
    })
  })

  it('crosses month and year ends as calendar days', () => {
    expect(candidateWindow(['2026-01-01', '2025-12-31'])).toEqual({
      from: '2025-12-30',
      to: '2026-01-02',
    })
  })

  it('has no window when no row names a day', () => {
    expect(candidateWindow(['', 'soon'])).toBeNull()
  })
})
