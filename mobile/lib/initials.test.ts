/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import { initials } from './initials'

describe('initials', () => {
  it('takes the first letter of a single name', () => {
    expect(initials('Lester')).toBe('L')
  })

  it('takes first + last for a full name', () => {
    expect(initials('Lester Han')).toBe('LH')
  })

  it('ignores middle names', () => {
    expect(initials('Ada Grace Lovelace')).toBe('AL')
  })

  it('uppercases', () => {
    expect(initials('lester han')).toBe('LH')
  })

  it('collapses extra whitespace', () => {
    expect(initials('  Lester   Han  ')).toBe('LH')
  })

  it('falls back to ? for empty / nullish', () => {
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
    expect(initials(null)).toBe('?')
    expect(initials(undefined)).toBe('?')
  })
})
