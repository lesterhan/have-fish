import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parse as parseWise } from './wise-parser'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, '../fixtures', name), 'utf-8')

describe('parse', () => {
  test('parses a Wise CSV', () => {
    const result = parseWise(fixture('wise-sample.csv'))
    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(39)
    expect(result.transactions[1]).toMatchObject({
      date: new Date(),
      amount: '28.90',
      description: 'BIG BEANS COFFEE INC',
      currency: 'EUR'
    })
    expect(result.transactions[1].date).toEqual(new Date('2026-03-07 16:56:40'))

    expect(result.transactions[38]).toMatchObject({
      date: new Date(),
      amount: '107.90',
      description: 'Darth Vader',
      currency: 'GBP'
    })
    expect(result.transactions[38].date).toEqual(new Date('2026-02-22 19:58:27'))
  })
})
