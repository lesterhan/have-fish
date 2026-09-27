import { describe, expect, it } from 'bun:test'
import { byAccount, candidateWindow, type ExistingPosting, findDuplicate } from './duplicates'

// No database here: the rule for "probably the same money" on its own.

const existing: ExistingPosting[] = [
  {
    transactionId: 'lunch',
    date: new Date('2026-03-10T12:00:00Z'),
    amount: '-42.50',
    currency: 'CAD',
  },
  {
    transactionId: 'yen',
    date: new Date('2026-03-10T12:00:00Z'),
    amount: '-8400.00',
    currency: 'JPY',
  },
]

describe('findDuplicate', () => {
  it('matches the same amount on the same day, ignoring sign and currency case', () => {
    expect(
      findDuplicate({ date: '2026-03-10', amount: '42.50', currency: 'cad' }, existing)
        ?.transactionId,
    ).toBe('lunch')
  })

  it('matches within a day either side, and not beyond', () => {
    expect(
      findDuplicate({ date: '2026-03-11T12:00:00Z', amount: '-42.50', currency: 'CAD' }, existing),
    ).toBeDefined()
    expect(
      findDuplicate({ date: '2026-03-09T12:00:00Z', amount: '-42.50', currency: 'CAD' }, existing),
    ).toBeDefined()
    expect(
      findDuplicate({ date: '2026-03-11T12:00:01Z', amount: '-42.50', currency: 'CAD' }, existing),
    ).toBeUndefined()
  })

  it('matches within a cent, and not beyond', () => {
    expect(
      findDuplicate({ date: '2026-03-10', amount: '-42.51', currency: 'CAD' }, existing),
    ).toBeDefined()
    expect(
      findDuplicate({ date: '2026-03-10', amount: '-42.52', currency: 'CAD' }, existing),
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
  it('reaches a day before the earliest row and to the end of the day after the latest', () => {
    const { from, to } = candidateWindow(['2026-03-10T12:00:00', '2026-03-05T08:00:00'])
    expect(from).toEqual(new Date('2026-03-04T08:00:00'))
    expect(to).toEqual(new Date('2026-03-11T23:59:59.999'))
  })
})
