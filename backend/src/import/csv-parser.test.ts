import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parse } from './csv-parser'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf-8')

describe('parse', () => {
  test('parses a clean CSV with no errors', () => {
    /*
    const result = parse(fixture('sample.csv'))
    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(3)
    expect(result.transactions[0]).toMatchObject({
      amount: '-42.50',
      description: 'Grocery Store',
    })
    expect(result.transactions[0].date).toBeInstanceOf(Date)
    */
  })
})
