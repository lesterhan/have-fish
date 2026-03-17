import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parse } from '../csv-parser'
import { toTransactions as WsToTransactions } from './ws-parser'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, '../fixtures', name), 'utf-8')

describe('toTransactions', () => {
  test('transform wealthsimple CSV data rows to transactions', () => {
    const csvDataRows = parse(fixture('ws-sample.csv'))
    const result = WsToTransactions(csvDataRows)
    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(15)

    expect(result.transactions[0]).toMatchObject(
      {
        amount: '10.43',
        description: 'Interest earned',
        currency: 'CAD'
      }
    )
    expect(result.transactions[0].date).toEqual(new Date('2026-02-01'))

    expect(result.transactions[2]).toMatchObject({
      amount: '-200.00',
      description: 'Pre-authorized Debit to CREDITCARD',
      currency: 'CAD'
    })
    expect(result.transactions[2].date).toEqual(new Date('2026-02-02'))
  })
})
