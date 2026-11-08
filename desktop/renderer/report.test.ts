import type { Spent } from '@have-fish/core/spending'
import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
import {
  idsWanted,
  lineLabel,
  otherText,
  spendsBehind,
  spentOf,
  thisWeek,
  weekAfter,
} from './report'

describe('the week shown', () => {
  test('this week is Monday to Sunday', () => {
    expect(thisWeek('2026-11-04')).toEqual({ start: '2026-11-02', end: '2026-11-08' })
  })

  test('◀ and ▶ go a week at a time, across months and years', () => {
    const week = thisWeek('2026-12-30')
    expect(weekAfter(week, -1)).toEqual({ start: '2026-12-21', end: '2026-12-27' })
    expect(weekAfter(week, 1)).toEqual({ start: '2027-01-04', end: '2027-01-10' })
  })
})

describe('spentOf', () => {
  test('the report’s amounts in cents', () => {
    const report = {
      currency: 'CAD',
      spent: [{ id: 'a', category: 'food', amount: '4.50' }],
      other: [],
    }
    expect(spentOf(report)).toEqual([{ id: 'a', category: 'food', cents: 450 }])
  })
})

describe('lineLabel', () => {
  test('a category by its last name; unsorted, and a level’s own, in words', () => {
    expect(lineLabel({ kind: 'category', label: 'coffee' })).toBe('coffee')
    expect(lineLabel({ kind: 'unsorted', label: '' })).toBe('Unsorted')
    expect(lineLabel({ kind: 'own', label: 'food' })).toBe('Just food')
  })
})

describe('otherText', () => {
  test('nothing in other currencies says nothing', () => {
    expect(otherText([])).toBeNull()
  })

  test('each other currency’s amount, once', () => {
    expect(
      otherText([
        { amount: '15.00', currency: 'EUR' },
        { amount: '500.00', currency: 'JPY' },
      ]),
    ).toBe('Not in these totals, in other currencies: 15.00 EUR · 500 JPY')
  })
})

describe('spendsBehind', () => {
  const t = (id: string): ListedTransaction => ({
    id,
    date: '2026-11-04',
    description: id,
    amounts: [],
    simple: null,
    from: null,
    to: null,
    fromPath: null,
    toPath: null,
    legs: [],
    origin: { source: 'manual', at: 0, here: true, file: null, line: null },
  })
  const listed = [t('coffee'), t('rent'), t('lunch'), t('bus'), t('transfer')]
  const spent: Spent[] = [
    { id: 'coffee', category: 'food:coffee', cents: 450 },
    { id: 'lunch', category: 'food', cents: 1200 },
    { id: 'bus', category: '', cents: 330 },
    { id: 'rent', category: 'home', cents: 100000 },
  ]
  const ids = (ts: ListedTransaction[]) => ts.map((x) => x.id)

  test('nothing picked at the top: every spend in the week, in the list’s order', () => {
    expect(ids(spendsBehind(listed, spent, '', undefined))).toEqual([
      'coffee',
      'rent',
      'lunch',
      'bus',
    ])
  })

  test('nothing picked inside a category: everything under it', () => {
    expect(ids(spendsBehind(listed, spent, 'food', undefined))).toEqual(['coffee', 'lunch'])
  })

  test('a line picked: what’s behind it', () => {
    const own = { kind: 'own', category: 'food' } as const
    expect(ids(spendsBehind(listed, spent, 'food', own))).toEqual(['lunch'])
    const unsorted = { kind: 'unsorted', category: '' } as const
    expect(ids(spendsBehind(listed, spent, '', unsorted))).toEqual(['bus'])
  })

  test("asks main for the level's spends, once each", () => {
    expect(idsWanted(spent, 'food').sort()).toEqual(['coffee', 'lunch'])
    expect(idsWanted(spent, 'food').sort()).toEqual(['coffee', 'lunch'])
    expect(idsWanted(spent, '').sort()).toEqual(['bus', 'coffee', 'lunch', 'rent'])
  })
})
