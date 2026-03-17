import { describe, test, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { transactionsFromCsv } from './csv-parser'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf-8')

describe('transactionsFromCsv', () => {
  test('uses the correct ws parser', () => {

    const wsParser = {
      isValidDataRow: () => true,
      toTransactions: mock(() => ({ transactions: [], errors: [] }))
    }
    const wiseParser = {
      isValidDataRow: () => true,
      toTransactions: mock(() => ({ transactions: [], errors: [] }))
    }

    transactionsFromCsv(fixture('ws-sample.csv'), [wsParser, wiseParser])
    expect(wsParser.toTransactions).toHaveBeenCalled()
    expect(wiseParser.toTransactions).not.toHaveBeenCalled()
  })
})
