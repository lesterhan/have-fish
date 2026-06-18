/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import {
  ALL_CURRENCIES,
  currencyFlag,
  isSupportedCurrency,
  lastCurrencyKey,
  orderByRecent,
  pushRecent,
  topRecents,
} from './currency'

describe('currency catalogue', () => {
  it('has no duplicates', () => {
    expect(new Set(ALL_CURRENCIES).size).toBe(ALL_CURRENCIES.length)
  })

  it('every currency has a flag', () => {
    for (const code of ALL_CURRENCIES) {
      expect(currencyFlag(code)).not.toBe('')
    }
  })

  it('returns empty flag for an unknown code', () => {
    expect(currencyFlag('XYZ')).toBe('')
  })

  it('recognises supported / unsupported codes', () => {
    expect(isSupportedCurrency('JPY')).toBe(true)
    expect(isSupportedCurrency('XYZ')).toBe(false)
  })
})

describe('pushRecent', () => {
  it('prepends a new code', () => {
    expect(pushRecent(['EUR', 'USD'], 'JPY')).toEqual(['JPY', 'EUR', 'USD'])
  })

  it('moves an existing code to the front without duplicating', () => {
    expect(pushRecent(['EUR', 'USD', 'JPY'], 'USD')).toEqual(['USD', 'EUR', 'JPY'])
  })

  it('caps the list length', () => {
    expect(pushRecent(['1', '2', '3'], '0', 3)).toEqual(['0', '1', '2'])
  })
})

describe('topRecents', () => {
  it('puts the current selection first even with no history', () => {
    expect(topRecents('CAD', [])).toEqual(['CAD'])
  })

  it('does not duplicate the selection already in recents', () => {
    expect(topRecents('USD', ['EUR', 'USD', 'JPY'])).toEqual(['USD', 'EUR', 'JPY'])
  })

  it('caps to the visible count', () => {
    expect(topRecents('CAD', ['EUR', 'USD', 'JPY', 'GBP'], 3)).toEqual(['CAD', 'EUR', 'USD'])
  })
})

describe('orderByRecent', () => {
  it('floats recents to the top, then canonical order', () => {
    const ordered = orderByRecent(['JPY', 'USD'])
    expect(ordered.slice(0, 2)).toEqual(['JPY', 'USD'])
    // The rest preserves the canonical order, minus the floated recents.
    expect(ordered).toHaveLength(ALL_CURRENCIES.length)
    expect(new Set(ordered).size).toBe(ALL_CURRENCIES.length)
    expect(ordered[2]).toBe('CAD') // first canonical entry not already floated
  })

  it('ignores unsupported recents', () => {
    const ordered = orderByRecent(['XYZ', 'EUR'])
    expect(ordered[0]).toBe('EUR')
    expect(ordered).toHaveLength(ALL_CURRENCIES.length)
  })

  it('returns the canonical list when there are no recents', () => {
    expect(orderByRecent([])).toEqual([...ALL_CURRENCIES])
  })
})

describe('lastCurrencyKey', () => {
  it('namespaces by group id', () => {
    expect(lastCurrencyKey('abc')).toBe('havefish_last_currency_abc')
  })
})
