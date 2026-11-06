import { describe, expect, test } from 'vitest'
import { columnsOf, daysOf, NARROW_LIST, wayOf } from './row'

describe('which way a row’s money went', () => {
  test('from income is in; between two of my accounts is between; to a category is out', () => {
    expect(wayOf({ fromPath: 'income:sales', toPath: 'assets:cash' })).toBe('in')
    expect(wayOf({ fromPath: 'assets:chequing', toPath: 'liabilities:visa' })).toBe('between')
    expect(wayOf({ fromPath: 'liabilities:visa', toPath: 'expenses:food' })).toBe('out')
  })

  test('with no one From and To, out: no sign', () => {
    expect(wayOf({ fromPath: null, toPath: null })).toBe('out')
  })
})

describe('the days of a list held whole', () => {
  test('a run of rows on one day is a day, in the order they come', () => {
    const rows = ['2026-11-05', '2026-11-05', '2026-11-03', '2026-10-29', '2026-10-29'].map(
      (date) => ({ date }),
    )
    expect(daysOf(rows)).toEqual([
      { date: '2026-11-05', count: 2 },
      { date: '2026-11-03', count: 1 },
      { date: '2026-10-29', count: 2 },
    ])
  })

  test('none is none', () => {
    expect(daysOf([])).toEqual([])
  })
})

describe('the ledger’s columns', () => {
  test('a list narrower than the narrow list leaves From out; the details still show it', () => {
    expect(columnsOf(NARROW_LIST - 1).cells).toEqual(['amount', 'to', 'description', 'draft'])
    expect(columnsOf(329).cells).not.toContain('from')
  })

  test('from the narrow list up, From leads, as what happened reads', () => {
    expect(columnsOf(NARROW_LIST).cells).toEqual(['from', 'amount', 'to', 'description', 'draft'])
  })

  test('a width for each cell, so the headings and rows share them', () => {
    for (const width of [329, 960]) {
      const { cells, template } = columnsOf(width)
      expect(template.split(' ')).toHaveLength(cells.length)
    }
  })
})
