/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import {
  appendDigit,
  appendDot,
  backspace,
  formatAmountDisplay,
  isPositiveAmount,
} from './amount-input'

describe('appendDigit', () => {
  it('appends to an empty amount', () => {
    expect(appendDigit('', '5')).toBe('5')
  })

  it('replaces a lone leading zero', () => {
    expect(appendDigit('0', '5')).toBe('5')
  })

  it('keeps typing cents after a leading "0."', () => {
    expect(appendDigit('0.', '5')).toBe('0.5')
  })

  it('appends normal trailing digits', () => {
    expect(appendDigit('12', '3')).toBe('123')
  })

  it('caps decimals at two places', () => {
    expect(appendDigit('1.23', '4')).toBe('1.23')
  })

  it('allows up to two decimals', () => {
    expect(appendDigit('1.2', '3')).toBe('1.23')
  })

  it('caps the raw length at ten characters', () => {
    expect(appendDigit('1234567890', '1')).toBe('1234567890')
  })
})

describe('appendDot', () => {
  it('turns an empty amount into "0."', () => {
    expect(appendDot('')).toBe('0.')
  })

  it('adds a single dot', () => {
    expect(appendDot('12')).toBe('12.')
  })

  it('ignores a second dot', () => {
    expect(appendDot('12.3')).toBe('12.3')
  })
})

describe('backspace', () => {
  it('drops the last character', () => {
    expect(backspace('123')).toBe('12')
  })

  it('drops a trailing dot', () => {
    expect(backspace('12.')).toBe('12')
  })

  it('backspaces to empty', () => {
    expect(backspace('1')).toBe('')
    expect(formatAmountDisplay(backspace('1'))).toBe('0.00')
  })
})

describe('isPositiveAmount', () => {
  it('is false for empty / zero / partial', () => {
    expect(isPositiveAmount('')).toBe(false)
    expect(isPositiveAmount('0')).toBe(false)
    expect(isPositiveAmount('0.')).toBe(false)
    expect(isPositiveAmount('0.00')).toBe(false)
  })

  it('is true for a real positive value', () => {
    expect(isPositiveAmount('0.01')).toBe(true)
    expect(isPositiveAmount('12.5')).toBe(true)
  })
})

describe('formatAmountDisplay', () => {
  it('renders empty as "0.00"', () => {
    expect(formatAmountDisplay('')).toBe('0.00')
  })

  it('passes a trailing dot through', () => {
    expect(formatAmountDisplay('12.')).toBe('12.')
  })

  it('shows decimals exactly as typed', () => {
    expect(formatAmountDisplay('12.5')).toBe('12.5')
    expect(formatAmountDisplay('12.50')).toBe('12.50')
  })

  it('adds thousands separators to the integer part', () => {
    expect(formatAmountDisplay('1000')).toBe('1,000')
    expect(formatAmountDisplay('1234567')).toBe('1,234,567')
  })

  it('separates the integer part of a decimal amount', () => {
    expect(formatAmountDisplay('1234.5')).toBe('1,234.5')
  })
})
