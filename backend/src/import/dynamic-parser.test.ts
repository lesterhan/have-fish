import { describe, expect, it } from 'bun:test'
import { buildParser } from './dynamic-parser'
import type {
  ParseError,
  ParseResult,
  RegularParsedTransaction,
  SameCurrencyTransferParsedTransaction,
  TransferParsedTransaction,
} from './types'

/**
 * The parsed row at `index`, as the kind the assertions below are about to read.
 *
 * `result.transactions[0].amount` asserts two things silently: that a row came back at
 * all, and that it is the regular kind — `ParsedTransaction` is a discriminated union and
 * only one arm has an `amount`. Worse, where this file wrapped its assertions in
 * `if (tx.isTransfer === 'same-currency')`, a parser that returned the wrong kind made the
 * test pass by running none of them.
 *
 * These say the assumption out loud and throw when it does not hold, so the failure names
 * the kind that actually came back.
 */
function rowAt(result: ParseResult, index = 0) {
  const row = result.transactions[index]
  if (row === undefined) {
    throw new Error(`expected a row at ${index}, got ${result.transactions.length} rows`)
  }
  return row
}

function regular(result: ParseResult, index = 0): RegularParsedTransaction {
  const row = rowAt(result, index)
  if (row.isTransfer !== false) throw new Error(`row ${index} is a ${String(row.isTransfer)} row`)
  return row
}

function transfer(result: ParseResult, index = 0): TransferParsedTransaction {
  const row = rowAt(result, index)
  if (row.isTransfer !== true) throw new Error(`row ${index} is a ${String(row.isTransfer)} row`)
  return row
}

function sameCurrency(result: ParseResult, index = 0): SameCurrencyTransferParsedTransaction {
  const row = rowAt(result, index)
  if (row.isTransfer !== 'same-currency') {
    throw new Error(`row ${index} is a ${String(row.isTransfer)} row`)
  }
  return row
}

function errorAt(result: ParseResult, index = 0): ParseError {
  const err = result.errors[index]
  if (err === undefined) {
    throw new Error(`expected an error at ${index}, got ${result.errors.length} errors`)
  }
  return err
}

describe('buildParser', () => {
  const parse = buildParser({
    date: 'date',
    amount: 'amount',
    description: 'description',
    currency: 'currency',
  })

  it('maps CSV rows to ParsedTransactions using the column mapping', () => {
    const result = parse([
      { date: '2026-02-15', amount: '-42.50', description: 'Grocery run', currency: 'CAD' },
    ])

    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(1)
    expect(regular(result).date).toBe(new Date('2026-02-15').toISOString())
    expect(regular(result).amount).toBe('-42.50')
    expect(regular(result).description).toBe('Grocery run')
    expect(regular(result).currency).toBe('CAD')
  })

  it('normalises amounts to 2 decimal places', () => {
    const result = parse([{ date: '2026-02-15', amount: '-19.9', description: '' }])
    expect(result.errors).toHaveLength(0)
    expect(regular(result).amount).toBe('-19.90')
  })

  it('records an error for an unparseable date and skips the row', () => {
    const result = parse([{ date: 'not-a-date', amount: '10.00', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(errorAt(result).row).toBe(1)
    expect(errorAt(result).reason).toMatch(/invalid date/)
  })

  it('records an error for an unparseable amount and skips the row', () => {
    const result = parse([{ date: '2026-02-15', amount: 'N/A', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(errorAt(result).row).toBe(1)
    expect(errorAt(result).reason).toMatch(/invalid amount/)
  })

  it('records an error for an empty date and skips the row', () => {
    const result = parse([{ date: '', amount: '10.00', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(errorAt(result).reason).toMatch(/invalid date/)
  })

  it('records an error for an empty amount and skips the row', () => {
    const result = parse([{ date: '2026-02-15', amount: '', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(errorAt(result).reason).toMatch(/invalid amount/)
  })

  it('reports the correct 1-indexed row number for each error', () => {
    const result = parse([
      { date: '2026-02-15', amount: '-10.00', description: 'ok' },
      { date: 'bad', amount: '-20.00', description: 'bad date' },
      { date: '2026-02-17', amount: '-30.00', description: 'ok' },
      { date: '2026-02-18', amount: 'bad', description: 'bad amount' },
    ])
    expect(result.transactions).toHaveLength(2)
    expect(result.errors).toHaveLength(2)
    expect(errorAt(result).row).toBe(2)
    expect(errorAt(result, 1).row).toBe(4)
  })

  it('omits optional fields when not in the mapping', () => {
    const parseMinimal = buildParser({ date: 'date', amount: 'amount' })
    const result = parseMinimal([
      { date: '2026-02-15', amount: '5.00', description: 'ignored', currency: 'USD' },
    ])
    expect(result.errors).toHaveLength(0)
    expect(regular(result).description).toBeUndefined()
    expect(regular(result).currency).toBeUndefined()
  })

  it('regular rows have isTransfer: false', () => {
    const result = parse([
      { date: '2026-02-15', amount: '-42.50', description: 'Coffee', currency: 'CAD' },
    ])
    expect(rowAt(result).isTransfer).toBe(false)
  })
})

describe('buildParser — direction sign', () => {
  const parseWithSign = buildParser({
    date: 'date',
    amount: 'amount',
    signColumn: 'direction',
    signNegativeValue: 'out',
  })

  it('negates the amount when the sign column matches signNegativeValue (case-insensitive)', () => {
    const result = parseWithSign([{ date: '2026-03-08', amount: '2.60', direction: 'OUT' }])
    expect(result.errors).toHaveLength(0)
    expect(regular(result).amount).toBe('-2.60')
  })
})

describe('buildParser — same-currency transfer detection', () => {
  const parseSameCurrency = buildParser({
    date: 'date',
    amount: 'sourceamount',
    sourceAmount: 'sourceamount',
    sourceCurrency: 'sourcecurrency',
    targetAmount: 'targetamount',
    targetCurrency: 'targetcurrency',
    feeAmount: 'feeamount',
  })

  it('emits a same-currency transfer when currencies match and fee is non-zero', () => {
    const result = parseSameCurrency([
      {
        date: '2026-03-31',
        sourceamount: '199.69',
        sourcecurrency: 'CAD',
        targetamount: '199.69',
        targetcurrency: 'CAD',
        feeamount: '0.62',
      },
    ])

    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(1)
    const tx = sameCurrency(result)
    expect(tx.amount).toBe('199.69')
    expect(tx.feeAmount).toBe('0.62')
    expect(tx.currency).toBe('CAD')
  })
})

describe('buildParser — transfer detection', () => {
  const parseTransfer = buildParser({
    date: 'date',
    amount: 'sourceamount',
    sourceAmount: 'sourceamount',
    sourceCurrency: 'sourcecurrency',
    targetAmount: 'targetamount',
    targetCurrency: 'targetcurrency',
    feeAmount: 'feeamount',
    feeCurrency: 'feecurrency',
  })

  it('emits a TransferParsedTransaction when sourceCurrency ≠ targetCurrency', () => {
    const result = parseTransfer([
      {
        date: '2026-03-01',
        sourceamount: '200.00',
        sourcecurrency: 'CAD',
        targetamount: '107.90',
        targetcurrency: 'GBP',
        feeamount: '0.96',
        feecurrency: 'CAD',
      },
    ])

    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(1)
    const tx = transfer(result)
    expect(tx.sourceAmount).toBe('-200.00')
    expect(tx.sourceCurrency).toBe('CAD')
    expect(tx.targetAmount).toBe('107.90')
    expect(tx.targetCurrency).toBe('GBP')
    expect(tx.feeAmount).toBe('0.96')
    expect(tx.feeCurrency).toBe('CAD')
  })
})
