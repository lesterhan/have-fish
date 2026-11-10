import { describe, expect, test } from 'vitest'
import {
  type ComparedLine,
  comparedAt,
  isIn,
  isUnder,
  type SpendingLine,
  type Spent,
  spendingAt,
} from './spending'

let n = 0
const spent = (category: string, cents: number): Spent => ({ id: `s${++n}`, category, cents })

/** A line as `label › cents`, with `›` for one that opens and its kind when not a category. */
const line = (l: SpendingLine) =>
  `${l.kind === 'category' ? '' : `${l.kind} `}${l.label}${l.opens ? ' ›' : ''} ${l.cents}`

/** A compared line as `label › this before`, each a sum or `–`. */
const compared = (l: ComparedLine) =>
  `${l.kind === 'category' ? '' : `${l.kind} `}${l.label}${l.opens ? ' ›' : ''} ${l.cents ?? '–'} ${l.before ?? '–'}`

describe('spendingAt', () => {
  test('nothing spent: no lines and a total of zero', () => {
    expect(spendingAt([], '')).toEqual({ total: 0, lines: [] })
  })

  test('a line carries no share: the bars went with the list they drew', () => {
    const [first] = spendingAt([spent('food', 1000)], '').lines
    expect(first).not.toHaveProperty('share')
  })

  test('the top: each category its total, biggest first; the total is their sum', () => {
    const level = spendingAt(
      [spent('food', 1000), spent('transport', 3000), spent('food', 500), spent('fun', 500)],
      '',
    )
    expect(level.total).toBe(5000)
    expect(level.lines.map(line)).toEqual(['transport 3000', 'food 1500', 'fun 500'])
  })

  test('a category with categories under it rolls them in, and opens', () => {
    const level = spendingAt(
      [spent('food:coffee', 450), spent('food:groceries', 5000), spent('fun', 1000)],
      '',
    )
    expect(level.lines.map(line)).toEqual(['food › 5450', 'fun 1000'])
  })

  test('unsorted is a line of its own, last, whatever its size', () => {
    const level = spendingAt([spent('', 9000), spent('food', 1000)], '')
    expect(level.lines.map(line)).toEqual(['food 1000', 'unsorted  9000'])
    expect(level.total).toBe(10000)
  })

  test('going into a category: the ones under it, and what went to it itself, last', () => {
    const all = [
      spent('food', 200),
      spent('food:coffee', 450),
      spent('food:groceries:produce', 1000),
      spent('food:groceries', 350),
      spent('fun', 9999),
      spent('', 1),
    ]
    const level = spendingAt(all, 'food')
    expect(level.lines.map(line)).toEqual(['groceries › 1350', 'coffee 450', 'own food 200'])
    expect(level.total).toBe(2000)
    expect(spendingAt(all, 'food:groceries').lines.map(line)).toEqual([
      'produce 1000',
      'own groceries 350',
    ])
  })

  test('equal amounts go by name, without regard to case', () => {
    const level = spendingAt([spent('rent', 100), spent('Books', 100), spent('art', 100)], '')
    expect(level.lines.map((l) => l.label)).toEqual(['art', 'Books', 'rent'])
  })

  test('money back into a category lowers it', () => {
    const level = spendingAt([spent('food', 1000), spent('fun', 500), spent('fun', -800)], '')
    expect(level.lines.map(line)).toEqual(['food 1000', 'fun -300'])
    expect(level.total).toBe(700)
  })

  test('a category whose name starts like another is not under it', () => {
    const level = spendingAt([spent('food', 100), spent('foodtruck', 200)], 'food')
    expect(level.lines.map(line)).toEqual(['own food 100'])
  })
})

describe('comparedAt', () => {
  test('nothing either week: no lines and both sums zero', () => {
    expect(comparedAt([], [], '')).toEqual({ total: 0, before: 0, lines: [] })
  })

  test('each category this week and last; the sums of each week', () => {
    const at = comparedAt(
      [spent('food', 6000), spent('transport', 3000)],
      [spent('food', 8000)],
      '',
    )
    expect(at.total).toBe(9000)
    expect(at.before).toBe(8000)
    expect(at.lines.map(compared)).toEqual(['food 6000 8000', 'transport 3000 –'])
  })

  test('a category only last week shows with a dash this week', () => {
    const at = comparedAt([], [spent('fun', 1500)], '')
    expect(at.total).toBe(0)
    expect(at.before).toBe(1500)
    expect(at.lines.map(compared)).toEqual(['fun – 1500'])
  })

  test('the level’s categories: this week biggest first, then last week’s, then by name', () => {
    const at = comparedAt(
      [spent('food:restaurants', 1593), spent('food:groceries', 646)],
      [
        spent('food:restaurants', 2257),
        spent('food:groceries', 4476),
        spent('food:restaurant', 1637),
        spent('food:coffee', 389),
      ],
      'food',
    )
    expect(at.lines.map((l) => l.label)).toEqual([
      'restaurants',
      'groceries',
      'restaurant',
      'coffee',
    ])
  })

  test('a category opens from the week before alone', () => {
    const at = comparedAt([spent('food', 500)], [spent('food:coffee', 389)], '')
    expect(at.lines.map(compared)).toEqual(['food › 500 389'])
  })

  test('the level’s own last; unsorted last at the top, whatever its size', () => {
    const own = comparedAt([spent('food', 550), spent('food:coffee', 450)], [], 'food')
    expect(own.lines.map(compared)).toEqual(['coffee 450 –', 'own food 550 –'])

    const top = comparedAt([spent('', 9000), spent('food', 1000)], [], '')
    expect(top.lines.map(compared)).toEqual(['food 1000 –', 'unsorted  9000 –'])
  })

  test('money back makes zero, not a dash', () => {
    const at = comparedAt([spent('fun', 1000), spent('fun', -1000)], [], '')
    expect(at.lines.map(compared)).toEqual(['fun 0 –'])
  })

  test('a tie in both weeks goes by name', () => {
    const at = comparedAt(
      [spent('fun', 500), spent('food', 500)],
      [spent('fun', 300), spent('food', 300)],
      '',
    )
    expect(at.lines.map((l) => l.label)).toEqual(['food', 'fun'])
  })
})

describe('which spends are behind a line', () => {
  const coffee = spent('food:coffee', 450)
  const food = spent('food', 200)
  const loose = spent('', 300)

  test('a category: it and everything under it', () => {
    const line = { kind: 'category', category: 'food' } as const
    expect([coffee, food, loose].map((s) => isIn(s, line))).toEqual([true, true, false])
  })

  test('the level’s own: only what went to it itself', () => {
    const line = { kind: 'own', category: 'food' } as const
    expect([coffee, food, loose].map((s) => isIn(s, line))).toEqual([false, true, false])
  })

  test('unsorted: what went to none', () => {
    const line = { kind: 'unsorted', category: '' } as const
    expect([coffee, food, loose].map((s) => isIn(s, line))).toEqual([false, false, true])
  })

  test('everything is under the top', () => {
    expect([coffee, food, loose].map((s) => isUnder(s, ''))).toEqual([true, true, true])
  })
})
