import { describe, it, expect } from 'bun:test'
import { isClassifiedAs, toClassifierType } from './api'

describe('toClassifierType', () => {
  it('collapses the two override-only types into their parent bucket', () => {
    // Cash is a subtype of Asset and Conversion of Equity, per hledger. Views that
    // reason in the coarse buckets must see them as their parents, not as unknowns.
    expect(toClassifierType('cash')).toBe('asset')
    expect(toClassifierType('conversion')).toBe('equity')
  })

  it('maps every inferable type to itself', () => {
    expect(toClassifierType('asset')).toBe('asset')
    expect(toClassifierType('liability')).toBe('liability')
    expect(toClassifierType('equity')).toBe('equity')
    expect(toClassifierType('income')).toBe('income')
    expect(toClassifierType('expense')).toBe('expense')
  })
})

describe('isClassifiedAs', () => {
  it('matches an account on its own type', () => {
    expect(isClassifiedAs({ resolvedType: 'asset' }, 'asset')).toBe(true)
    expect(isClassifiedAs({ resolvedType: 'liability' }, 'liability')).toBe(true)
  })

  it('counts a cash wallet as an asset', () => {
    // The case the dashboard's cash-runway sum depends on: a tagged wallet is money
    // on hand and has to be included in the asset total.
    expect(isClassifiedAs({ resolvedType: 'cash' }, 'asset')).toBe(true)
  })

  it('does not match a different bucket', () => {
    expect(isClassifiedAs({ resolvedType: 'cash' }, 'liability')).toBe(false)
    expect(isClassifiedAs({ resolvedType: 'expense' }, 'asset')).toBe(false)
  })

  it('matches nothing when the type is unresolved', () => {
    // An atypical root with no override can't be placed. Counting it as an asset
    // would quietly inflate the dashboard's totals.
    expect(isClassifiedAs({ resolvedType: null }, 'asset')).toBe(false)
    expect(isClassifiedAs({ resolvedType: undefined }, 'asset')).toBe(false)
    expect(isClassifiedAs({}, 'asset')).toBe(false)
  })
})
