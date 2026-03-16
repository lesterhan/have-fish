import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parse as parseWs } from './ws-parser'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, '../fixtures', name), 'utf-8')

describe('parse', () => {
  test('parses a wealthsimple CSV with no errors', () => {
    /*
    const result = parseWs(fixture('ws-sample.csv'))
    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(15)
    expect(result.transactions[0]).toMatchObject({
      date: new Date(2026, 2, 1),
      amount: '22.01',
      description: 'Interest earned',
    })
    expect(result.transactions[0].date).toBeInstanceOf(Date)
    */
  })
})
