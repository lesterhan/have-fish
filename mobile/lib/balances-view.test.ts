/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import type { CurrencyBalance } from './api'
import {
  MINUS,
  balanceMagnitude,
  currencySymbol,
  formatAmount,
  formatSigned,
  isAllSettled,
  isZeroNet,
  visibleBalances,
} from './balances-view'

function balance(currency: string, nets: Record<string, string>): CurrencyBalance {
  return {
    currency,
    netPositions: Object.entries(nets).map(([userId, amount]) => ({
      userId,
      userName: userId,
      amount,
    })),
    transfers: [],
  }
}

describe('currencySymbol', () => {
  it('returns the symbol for known codes', () => {
    expect(currencySymbol('CAD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('JPY')).toBe('¥')
  })

  it('returns empty string for unknown codes', () => {
    expect(currencySymbol('XYZ')).toBe('')
    expect(currencySymbol('')).toBe('')
  })
})

describe('formatAmount', () => {
  it('forces 2 decimals and thousands separators', () => {
    expect(formatAmount('1840.3')).toBe('1,840.30')
    expect(formatAmount('1234567.5')).toBe('1,234,567.50')
    expect(formatAmount('0')).toBe('0.00')
  })

  it('takes the magnitude of a negative value', () => {
    expect(formatAmount('-50')).toBe('50.00')
  })

  it('falls back to 0.00 for non-numeric input', () => {
    expect(formatAmount('abc')).toBe('0.00')
  })
})

describe('formatSigned', () => {
  it('prefixes a plus for positive', () => {
    expect(formatSigned('1840.30')).toEqual({ text: '+1,840.30', positive: true })
  })

  it('uses the real minus glyph for negative', () => {
    const r = formatSigned('-1840.30')
    expect(r).toEqual({ text: `${MINUS}1,840.30`, positive: false })
    expect(r.text).not.toContain('-') // not the ASCII hyphen
  })

  it('treats zero as positive', () => {
    expect(formatSigned('0')).toEqual({ text: '+0.00', positive: true })
  })
})

describe('balanceMagnitude', () => {
  it('is the largest absolute net position', () => {
    expect(balanceMagnitude(balance('CAD', { A: '500.00', P: '-500.00' }))).toBe(500)
    expect(balanceMagnitude(balance('EUR', { A: '-30', B: '10', C: '20' }))).toBe(30)
  })
})

describe('isZeroNet', () => {
  it('is true when everyone nets ~zero', () => {
    expect(isZeroNet(balance('CAD', { A: '0.00', P: '0.00' }))).toBe(true)
    expect(isZeroNet(balance('CAD', { A: '0.004', P: '-0.004' }))).toBe(true)
  })

  it('is false when someone owes', () => {
    expect(isZeroNet(balance('CAD', { A: '5.00', P: '-5.00' }))).toBe(false)
  })
})

describe('visibleBalances', () => {
  it('hides zero-net currencies and sorts by magnitude desc', () => {
    const out = visibleBalances([
      balance('EUR', { A: '50', P: '-50' }),
      balance('USD', { A: '0', P: '0' }),
      balance('CAD', { A: '500', P: '-500' }),
    ])
    expect(out.map((b) => b.currency)).toEqual(['CAD', 'EUR'])
  })
})

describe('isAllSettled', () => {
  it('is true when nothing is owed in any currency', () => {
    expect(isAllSettled([balance('CAD', { A: '0', P: '0' })])).toBe(true)
    expect(isAllSettled([])).toBe(true)
  })

  it('is false when any currency has a balance', () => {
    expect(isAllSettled([balance('CAD', { A: '5', P: '-5' })])).toBe(false)
  })
})
