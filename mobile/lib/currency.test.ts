/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import {
  ALL_CURRENCIES,
  QUICK_CURRENCIES,
  currencySymbol,
  lastCurrencyKey,
} from './currency'

describe('currency catalogue', () => {
  it('quick list is a subset of the full list', () => {
    for (const code of QUICK_CURRENCIES) {
      expect(ALL_CURRENCIES).toContain(code)
    }
  })

  it('the full list has no duplicates', () => {
    expect(new Set(ALL_CURRENCIES).size).toBe(ALL_CURRENCIES.length)
  })
})

describe('currencySymbol', () => {
  it('maps known codes to their symbol', () => {
    expect(currencySymbol('CAD')).toBe('$')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('JPY')).toBe('¥')
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('CZK')).toBe('Kč')
  })

  it('every catalogued currency has a symbol', () => {
    for (const code of ALL_CURRENCIES) {
      expect(currencySymbol(code)).not.toBe(code)
    }
  })

  it('falls back to the code for an unknown currency', () => {
    expect(currencySymbol('XYZ')).toBe('XYZ')
  })
})

describe('lastCurrencyKey', () => {
  it('namespaces by group id', () => {
    expect(lastCurrencyKey('abc')).toBe('havefish_last_currency_abc')
  })
})
