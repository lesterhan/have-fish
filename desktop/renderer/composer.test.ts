import { describe, expect, test } from 'vitest'
import {
  after as afterPart,
  before as beforePart,
  dateSuggestions,
  PARTS,
  type Part,
  startPart,
  tabMark,
} from './composer'

const values = (over: Partial<Record<Part, string>> = {}): Record<Part, string> => ({
  from: '',
  date: '',
  amount: '',
  description: '',
  to: '',
  ...over,
})

describe('the parts', () => {
  test('read From, Date, Amount, Description, To', () => {
    expect(PARTS).toEqual(['from', 'date', 'amount', 'description', 'to'])
  })

  test('Tab goes to the next part, and round from To to From', () => {
    expect(afterPart('from')).toBe('date')
    expect(afterPart('date')).toBe('amount')
    expect(afterPart('to')).toBe('from')
    expect(beforePart('from')).toBe('to')
    expect(beforePart('amount')).toBe('date')
  })

  test('the line starts in its first empty part, else at the amount', () => {
    expect(startPart(values())).toBe('from')
    expect(startPart(values({ from: 'visa', date: 'today' }))).toBe('amount')
    expect(startPart(values({ from: 'visa', date: 'today', amount: '4.50' }))).toBe('description')
    expect(
      startPart(values({ from: 'visa', date: 'today', amount: '4.50', description: 'Coffee' })),
    ).toBe('to')
    expect(
      startPart(
        values({ from: 'visa', date: 'today', amount: '4.50', description: 'Coffee', to: 'food' }),
      ),
    ).toBe('amount')
  })
})

describe('the Tab key', () => {
  test('an empty part being typed in is the one Tab comes to', () => {
    expect(tabMark('amount', values({ from: 'visa', date: 'today' }))).toBe('amount')
  })

  test('a filled part passes it to the next empty one', () => {
    expect(tabMark('amount', values({ from: 'visa', date: 'today', amount: '4.50' }))).toBe(
      'description',
    )
    expect(
      tabMark(
        'amount',
        values({ from: 'visa', date: 'today', amount: '4.50', description: 'Coffee' }),
      ),
    ).toBe('to')
  })

  test('with every part full, none is marked', () => {
    expect(
      tabMark(
        'amount',
        values({
          from: 'visa',
          date: 'today',
          amount: '4.50',
          description: 'Coffee',
          to: 'food:coffee',
        }),
      ),
    ).toBeNull()
  })
})

describe('the date list', () => {
  // A Wednesday, so the Monday shorthand is a day that isn't today.
  const today = '2026-11-11'

  test('it teaches the common shorthand when the field is empty', () => {
    expect(dateSuggestions('', today)).toEqual([
      { typed: 'today', date: '2026-11-11' },
      { typed: 'y', date: '2026-11-10' },
      { typed: '-2', date: '2026-11-09' },
      { typed: '10-31', date: '2026-10-31' },
    ])
  })

  test('a dash lists the last days, nearest first', () => {
    expect(dateSuggestions('-', today).map((c) => c.typed)).toEqual(['-1', '-2', '-3', '-4', '-5'])
    expect(dateSuggestions('-3', today)).toEqual([{ typed: '-3', date: '2026-11-08' }])
  })

  test('a weekday means the one just gone', () => {
    expect(dateSuggestions('mon', today)).toEqual([{ typed: 'mon', date: '2026-11-09' }])
    expect(dateSuggestions('monday', today)).toEqual([{ typed: 'monday', date: '2026-11-09' }])
  })

  test('a month and day mean the latest one, with its year', () => {
    expect(dateSuggestions('10-31', today)).toEqual([{ typed: '10-31', date: '2026-10-31' }])
    expect(dateSuggestions('10-3', today).map((c) => c.typed)).toEqual(['10-3', '10-31', '10-30'])
  })

  test('a full date is offered as itself, and a future one is not', () => {
    expect(dateSuggestions('2026-11-05', today)).toEqual([
      { typed: '2026-11-05', date: '2026-11-05' },
    ])
    expect(dateSuggestions('2027-01-01', today)).toEqual([])
  })

  test('what it cannot read offers nothing', () => {
    expect(dateSuggestions('soon', today)).toEqual([])
  })
})
