import { describe, it, expect } from 'bun:test'
import { buildParser } from './dynamic-parser'

describe('buildParser', () => {
  const parse = buildParser({ date: 'date', amount: 'amount', description: 'description', currency: 'currency' })

  it('maps CSV rows to ParsedTransactions using the column mapping', () => {
    const result = parse([
      { date: '2026-02-15', amount: '-42.50', description: 'Grocery run', currency: 'CAD' },
    ])

    expect(result.errors).toHaveLength(0)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].date).toBe(new Date('2026-02-15').toISOString())
    expect(result.transactions[0].amount).toBe('-42.50')
    expect(result.transactions[0].description).toBe('Grocery run')
    expect(result.transactions[0].currency).toBe('CAD')
  })

  it('normalises amounts to 2 decimal places', () => {
    const result = parse([{ date: '2026-02-15', amount: '-19.9', description: '' }])
    expect(result.errors).toHaveLength(0)
    expect(result.transactions[0].amount).toBe('-19.90')
  })

  it('records an error for an unparseable date and skips the row', () => {
    const result = parse([{ date: 'not-a-date', amount: '10.00', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(1)
    expect(result.errors[0].reason).toMatch(/invalid date/)
  })

  it('records an error for an unparseable amount and skips the row', () => {
    const result = parse([{ date: '2026-02-15', amount: 'N/A', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(1)
    expect(result.errors[0].reason).toMatch(/invalid amount/)
  })

  it('records an error for an empty date and skips the row', () => {
    const result = parse([{ date: '', amount: '10.00', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toMatch(/invalid date/)
  })

  it('records an error for an empty amount and skips the row', () => {
    const result = parse([{ date: '2026-02-15', amount: '', description: '' }])
    expect(result.transactions).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toMatch(/invalid amount/)
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
    expect(result.errors[0].row).toBe(2)
    expect(result.errors[1].row).toBe(4)
  })

  it('omits optional fields when not in the mapping', () => {
    const parseMinimal = buildParser({ date: 'date', amount: 'amount' })
    const result = parseMinimal([{ date: '2026-02-15', amount: '5.00', description: 'ignored', currency: 'USD' }])
    expect(result.errors).toHaveLength(0)
    expect(result.transactions[0].description).toBeUndefined()
    expect(result.transactions[0].currency).toBeUndefined()
  })
})
