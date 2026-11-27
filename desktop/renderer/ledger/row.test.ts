import { describe, expect, test } from 'vitest'
import { canRefile, columnsOf, daysOf, NARROW_LIST, wayOf } from './row'

describe('which way a row’s money went', () => {
  test('income is in; a transfer is between; a spend, a start or an other is out', () => {
    expect(wayOf('income')).toBe('in')
    expect(wayOf('transfer')).toBe('between')
    for (const shape of ['spend', 'start', 'other'] as const) expect(wayOf(shape)).toBe('out')
  })

  test('an exchange is between, as it moves between accounts of mine', () => {
    expect(wayOf('exchange')).toBe('between')
  })
})

describe('which rows R can refile', () => {
  test('a spend, a transfer, income or a converted spend can be refiled', () => {
    for (const shape of ['spend', 'transfer', 'income', 'converted'] as const) {
      expect(canRefile(shape), shape).toBe(true)
    }
    expect(canRefile('awaiting')).toBe(true)
  })

  test('an exchange keeps its To', () => {
    expect(canRefile('exchange')).toBe(false)
  })

  test('a start or an other has no To to move', () => {
    for (const shape of ['start', 'other'] as const) expect(canRefile(shape), shape).toBe(false)
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
    expect(columnsOf(NARROW_LIST - 1).cells).toEqual(['amount', 'to', 'description'])
    expect(columnsOf(329).cells).not.toContain('from')
  })

  test('from the narrow list up, From leads, as what happened reads', () => {
    expect(columnsOf(NARROW_LIST).cells).toEqual(['from', 'amount', 'to', 'description'])
  })

  test('a width for each cell, so the headings and rows share them', () => {
    for (const width of [329, 960]) {
      const { cells, template } = columnsOf(width)
      expect(template.split(' ')).toHaveLength(cells.length)
    }
  })
})
