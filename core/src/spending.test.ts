import { describe, expect, test } from 'vitest'
import {
  isIn,
  isUnder,
  levelAbove,
  type SpendingLine,
  type Spent,
  spendingAt,
  trailTo,
} from './spending'

let n = 0
const spent = (category: string, cents: number): Spent => ({ id: `s${++n}`, category, cents })

/** A line as `label cents share%`, with `›` for one that opens and its kind when not a category. */
const line = (l: SpendingLine) =>
  `${l.kind === 'category' ? '' : `${l.kind} `}${l.label}${l.opens ? ' ›' : ''} ${l.cents} ${Math.round(l.share * 100)}%`

describe('spendingAt', () => {
  test('nothing spent: no lines and a total of zero', () => {
    expect(spendingAt([], '')).toEqual({ total: 0, lines: [] })
  })

  test('the top: each category its total and share, biggest first; the total is their sum', () => {
    const level = spendingAt(
      [spent('food', 1000), spent('transport', 3000), spent('food', 500), spent('fun', 500)],
      '',
    )
    expect(level.total).toBe(5000)
    expect(level.lines.map(line)).toEqual(['transport 3000 60%', 'food 1500 30%', 'fun 500 10%'])
  })

  test('a category with categories under it rolls them in, and opens', () => {
    const level = spendingAt(
      [spent('food:coffee', 450), spent('food:groceries', 5000), spent('fun', 1000)],
      '',
    )
    expect(level.lines.map(line)).toEqual(['food › 5450 84%', 'fun 1000 16%'])
  })

  test('unsorted is a line of its own, last, whatever its size', () => {
    const level = spendingAt([spent('', 9000), spent('food', 1000)], '')
    expect(level.lines.map(line)).toEqual(['food 1000 10%', 'unsorted  9000 90%'])
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
    expect(level.lines.map(line)).toEqual([
      'groceries › 1350 68%',
      'coffee 450 23%',
      'own food 200 10%',
    ])
    expect(level.total).toBe(2000)
    expect(spendingAt(all, 'food:groceries').lines.map(line)).toEqual([
      'produce 1000 74%',
      'own groceries 350 26%',
    ])
  })

  test('equal amounts go by name, without regard to case', () => {
    const level = spendingAt([spent('rent', 100), spent('Books', 100), spent('art', 100)], '')
    expect(level.lines.map((l) => l.label)).toEqual(['art', 'Books', 'rent'])
  })

  test('money back into a category lowers it, and a line below zero has no share', () => {
    const level = spendingAt([spent('food', 1000), spent('fun', 500), spent('fun', -800)], '')
    expect(level.lines.map(line)).toEqual(['food 1000 100%', 'fun -300 0%'])
    expect(level.total).toBe(700)
  })

  test('a category whose name starts like another is not under it', () => {
    const level = spendingAt([spent('food', 100), spent('foodtruck', 200)], 'food')
    expect(level.lines.map(line)).toEqual(['own food 100 100%'])
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

describe('the trail', () => {
  test('from the top down to a level', () => {
    expect(trailTo('')).toEqual([])
    expect(trailTo('food:coffee:beans')).toEqual(['food', 'food:coffee', 'food:coffee:beans'])
  })

  test('the level above', () => {
    expect(levelAbove('food:coffee')).toBe('food')
    expect(levelAbove('food')).toBe('')
    expect(levelAbove('')).toBe('')
  })
})
