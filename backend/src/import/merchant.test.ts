import { describe, it, expect } from 'bun:test'
import { cleanDescription, merchantKey } from './merchant'

describe('cleanDescription', () => {
  it('collapses internal whitespace and trims', () => {
    expect(cleanDescription('  LOBLAWS   CITY  MARKET ')).toBe('LOBLAWS CITY MARKET')
  })

  it('strips a trailing store/terminal number', () => {
    expect(cleanDescription('LOBLAWS #042')).toBe('LOBLAWS')
    expect(cleanDescription('LOBLAWS # 042')).toBe('LOBLAWS')
  })

  it('strips trailing dates in several formats', () => {
    expect(cleanDescription('BILLA 2025-06-22')).toBe('BILLA')
    expect(cleanDescription('BILLA 06/22')).toBe('BILLA')
    expect(cleanDescription('BILLA 06-22-2025')).toBe('BILLA')
  })

  it('strips a trailing time', () => {
    expect(cleanDescription('STARBUCKS 14:30')).toBe('STARBUCKS')
    expect(cleanDescription('STARBUCKS 14:30:59')).toBe('STARBUCKS')
  })

  it('strips a trailing reference code, with or without a letter prefix', () => {
    expect(cleanDescription('AMAZON 123456789')).toBe('AMAZON')
    expect(cleanDescription('AMAZON AB123456')).toBe('AMAZON')
  })

  it('peels several stacked noise tokens', () => {
    expect(cleanDescription('LOBLAWS #042 06-22 14:30')).toBe('LOBLAWS')
  })

  it('leaves a clean description untouched', () => {
    expect(cleanDescription('MONTHLY RENT')).toBe('MONTHLY RENT')
  })

  it('does not strip digits that are part of the merchant name', () => {
    // Only trailing 4+ digit runs are treated as reference codes.
    expect(cleanDescription('7-ELEVEN')).toBe('7-ELEVEN')
  })
})

describe('merchantKey', () => {
  it('returns the cleaned stem when it is long enough to match on', () => {
    expect(merchantKey('LOBLAWS #042 06-22')).toBe('LOBLAWS')
  })

  it('gives near-duplicate descriptions from one merchant the same key', () => {
    const keys = new Set(
      ['LOBLAWS #042 06-22', 'LOBLAWS #117', 'LOBLAWS  #003 2025-06-30'].map(merchantKey),
    )
    expect([...keys]).toEqual(['LOBLAWS'])
  })

  it('falls back to the raw description when the stem is shorter than 3 characters', () => {
    // Cleaning leaves "A", which as a substring pattern would match almost anything.
    expect(merchantKey('A #0421')).toBe('A #0421')
  })

  it('returns an empty string for a description with no usable content', () => {
    expect(merchantKey('   ')).toBe('')
  })
})
