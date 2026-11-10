import type { Spent } from '@have-fish/core/spending'
import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
import {
  changeOf,
  closedOver,
  idsWanted,
  lineLabel,
  otherText,
  spendsBehind,
  spentOf,
  thisWeek,
  treeColumnsOf,
  treeKey,
  treeRows,
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

let n = 0
const spent = (category: string, cents: number): Spent => ({ id: `s${++n}`, category, cents })

/** A row as `level key open`, with `open` when it has rows under it. */
const row = (r: ReturnType<typeof treeRows>[number]) =>
  `${r.level} ${r.key} ${r.open === undefined ? '–' : r.open ? 'open' : 'closed'} ${r.posinset}/${r.setsize}`

describe('treeRows', () => {
  test('nothing opened: the top rows only, each closed where it has rows under it', () => {
    const shown = [spent('food:coffee', 450), spent('fun', 2000)]
    const before = [spent('food:groceries', 500)]
    expect(treeRows(shown, before, new Set()).map(row)).toEqual([
      '1 category:fun – 1/2',
      '1 category:food closed 2/2',
    ])
  })

  test('a category opened: its own rows under it, a level deeper, then the next top row', () => {
    const shown = [spent('food:coffee', 450), spent('fun', 2000)]
    const before = [spent('food:groceries', 500)]
    const rows = treeRows(shown, before, new Set(['food']))
    expect(rows.map(row)).toEqual([
      '1 category:fun – 1/2',
      '1 category:food open 2/2',
      '2 category:food:coffee – 1/2',
      '2 category:food:groceries – 2/2',
    ])
    expect(rows[2]?.parent).toBe('category:food')
  })

  test('a category opened inside another is a level deeper again', () => {
    const shown = [spent('food:restaurants:dining', 1000)]
    const rows = treeRows(shown, [], new Set(['food', 'food:restaurants']))
    expect(rows.map(row)).toEqual([
      '1 category:food open 1/1',
      '2 category:food:restaurants open 1/1',
      '3 category:food:restaurants:dining – 1/1',
    ])
  })

  test('a category opened in a week where nothing is under it has nothing under it', () => {
    const rows = treeRows([spent('food', 500)], [], new Set(['food']))
    expect(rows.map(row)).toEqual(['1 category:food – 1/1'])
    expect(rows[0]?.open).toBeUndefined()
  })
})

describe('treeKey', () => {
  const shown = [spent('food:coffee', 450), spent('food:groceries', 500), spent('fun', 2000)]
  const closed = treeRows(shown, [], new Set())
  const open = treeRows(shown, [], new Set(['food']))

  test('→ on a closed row with categories under it opens it', () => {
    expect(treeKey(closed, 'category:food', 'ArrowRight')).toEqual({ toggle: 'food' })
  })

  test('→ on an open row goes to its first child', () => {
    expect(treeKey(open, 'category:food', 'ArrowRight')).toEqual({
      active: 'category:food:groceries',
    })
  })

  test('← on an open row closes it', () => {
    expect(treeKey(open, 'category:food', 'ArrowLeft')).toEqual({ toggle: 'food' })
  })

  test('← on a child goes to its parent', () => {
    expect(treeKey(open, 'category:food:coffee', 'ArrowLeft')).toEqual({
      active: 'category:food',
    })
  })

  test('← at the top has nowhere to go', () => {
    expect(treeKey(closed, 'category:fun', 'ArrowLeft')).toBeNull()
  })

  test('Enter opens or closes a row that has categories under it, and does nothing else', () => {
    expect(treeKey(closed, 'category:food', 'Enter')).toEqual({ toggle: 'food' })
    expect(treeKey(closed, 'category:fun', 'Enter')).toBeNull()
    expect(treeKey(open, 'category:food:coffee', 'Enter')).toBeNull()
  })

  test('↓ and the rest are the list’s', () => {
    expect(treeKey(open, 'category:food', 'ArrowDown')).toBeNull()
  })
})

describe('closedOver', () => {
  const shown = [spent('food:coffee', 450), spent('fun', 2000)]
  const rows = treeRows(shown, [], new Set(['food']))

  test('a child selected: the category takes the selection', () => {
    expect(closedOver(rows, 'category:food:coffee', 'food')).toBe('category:food')
  })

  test('a row outside it keeps the selection', () => {
    expect(closedOver(rows, 'category:fun', 'food')).toBe('category:fun')
  })
})

describe('changeOf', () => {
  test('less than the week before', () => {
    expect(changeOf(6000, 8000)).toEqual({ cents: 2000, way: 'less' })
  })

  test('more than nothing', () => {
    expect(changeOf(18536, null)).toEqual({ cents: 18536, way: 'more' })
  })

  test('nothing this week is less than the week before', () => {
    expect(changeOf(null, 389)).toEqual({ cents: 389, way: 'less' })
  })

  test('the same either side says so, with nothing to add', () => {
    expect(changeOf(500, 500)).toEqual({ cents: 0, way: 'same' })
  })
})

describe('treeColumnsOf', () => {
  test('a narrow tree keeps This week and Change, and drops Last week', () => {
    expect(treeColumnsOf(364)).toEqual({
      cells: ['name', 'shown', 'change'],
      template: 'minmax(0,1fr) 5em 7em',
    })
  })

  test('from 440px the four columns show', () => {
    expect(treeColumnsOf(440)).toEqual({
      cells: ['name', 'shown', 'before', 'change'],
      template: 'minmax(0,1fr) 5em 5em 7em',
    })
  })
})

describe('idsWanted', () => {
  test('each spend of the week once, whatever is selected', () => {
    const week = [spent('food:coffee', 450), spent('fun', 2000), spent('food', 100)]
    expect(idsWanted(week)).toEqual([week[0]?.id, week[1]?.id, week[2]?.id])
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
  const week: Spent[] = [
    { id: 'coffee', category: 'food:coffee', cents: 450 },
    { id: 'lunch', category: 'food', cents: 1200 },
    { id: 'bus', category: '', cents: 330 },
    { id: 'rent', category: 'home', cents: 100000 },
  ]
  const ids = (ts: ListedTransaction[]) => ts.map((x) => x.id)

  test('nothing picked: every spend of the week, in the list’s order', () => {
    expect(ids(spendsBehind(listed, week, undefined))).toEqual(['coffee', 'rent', 'lunch', 'bus'])
  })

  test('a row picked: what’s behind it', () => {
    const coffee = { kind: 'category', category: 'food:coffee' } as const
    expect(ids(spendsBehind(listed, week, coffee))).toEqual(['coffee'])
    const food = { kind: 'own', category: 'food' } as const
    expect(ids(spendsBehind(listed, week, food))).toEqual(['lunch'])
    const unsorted = { kind: 'unsorted', category: '' } as const
    expect(ids(spendsBehind(listed, week, unsorted))).toEqual(['bus'])
  })
})
