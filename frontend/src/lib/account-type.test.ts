import { describe, it, expect } from 'bun:test'
import { toClassifierType } from './api'

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
