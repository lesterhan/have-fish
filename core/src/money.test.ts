import { describe, expect, it } from 'vitest'
import { add, cents, format, neg, parse, sub, sum } from './money'

describe('parse', () => {
  it('reads canonical amounts', () => {
    expect(parse('12.34')).toBe(1234)
    expect(parse('-12.34')).toBe(-1234)
    expect(parse('0.00')).toBe(0)
    expect(parse('9999999999.99')).toBe(999999999999)
  })

  it('reads every other way of writing a number', () => {
    expect(parse('5')).toBe(500)
    expect(parse('5.')).toBe(500)
    expect(parse('.5')).toBe(50)
    expect(parse('+5')).toBe(500)
    expect(parse(' 5 ')).toBe(500)
    expect(parse('007.10')).toBe(710)
    expect(parse('1e3')).toBe(100000)
    expect(parse('1.5E-1')).toBe(15)
    expect(parse('-2.5e+2')).toBe(-25000)
    expect(parse(String(0.1 + 0.2))).toBe(30)
  })

  // The same values the current app's database stored for these strings, so a ledger
  // carried over from it rounds the same.
  it('rounds to the cent, half away from zero', () => {
    expect(parse('12.345')).toBe(1235)
    expect(parse('-12.345')).toBe(-1235)
    expect(parse('12.3449999')).toBe(1234)
    expect(parse('0.005')).toBe(1)
    expect(parse('0.004')).toBe(0)
    expect(parse('1e-7')).toBe(0)
    expect(parse('9999999999.994')).toBe(999999999999)
  })

  it('never answers negative zero', () => {
    expect(Object.is(parse('-0.001'), 0)).toBe(true)
    expect(Object.is(parse('-0'), 0)).toBe(true)
  })

  it('refuses what is not a number', () => {
    for (const s of ['', ' ', '.', '-', 'abc', 'NaN', 'Infinity', '-Infinity', '1,000.00']) {
      expect(parse(s)).toBeNull()
    }
    for (const s of ['--5.00', '5.00.1', '5e', 'e5', '$5', '5 00', '0x10']) {
      expect(parse(s)).toBeNull()
    }
  })

  it('refuses an amount past the limit', () => {
    expect(parse('10000000000')).toBeNull()
    expect(parse('-10000000000')).toBeNull()
    expect(parse('9999999999.995')).toBeNull()
    expect(parse('1e10')).toBeNull()
    expect(parse('1e999999')).toBeNull()
    expect(parse('1e-999999')).toBe(0)
  })
})

describe('format', () => {
  it('writes two places, with a leading zero and a sign only when negative', () => {
    expect(format(1234)).toBe('12.34')
    expect(format(-1234)).toBe('-12.34')
    expect(format(5)).toBe('0.05')
    expect(format(-5)).toBe('-0.05')
    expect(format(0)).toBe('0.00')
    expect(format(-0)).toBe('0.00')
    expect(format(100)).toBe('1.00')
  })

  it('refuses a fraction of a cent or a number past exact integers', () => {
    expect(() => format(1.5)).toThrow(RangeError)
    expect(() => format(Number.NaN)).toThrow(RangeError)
    expect(() => format(2 ** 53)).toThrow(RangeError)
  })
})

describe('arithmetic', () => {
  it('adds without float error', () => {
    expect(sum(['0.10', '0.20'])).toBe('0.30')
    expect(add('0.10', '0.20')).toBe('0.30')
    expect(sum(Array.from({ length: 10 }, () => '0.10'))).toBe('1.00')
  })

  it('subtracts and negates', () => {
    expect(sub('0.30', '0.10')).toBe('0.20')
    expect(sub('0.10', '0.30')).toBe('-0.20')
    expect(neg('12.50')).toBe('-12.50')
    expect(neg('-12.50')).toBe('12.50')
    expect(neg('0.00')).toBe('0.00')
  })

  it('sums nothing to zero and a balanced set to exactly zero', () => {
    expect(sum([])).toBe('0.00')
    expect(sum(['100.00', '-33.33', '-33.33', '-33.34'])).toBe('0.00')
  })

  // A balance can pass the limit even though no posting does; a sum is bounded only by
  // exact integers.
  it('sums past what one posting could hold', () => {
    expect(sum(['9999999999.99', '9999999999.99'])).toBe('19999999999.98')
  })

  it('throws on something that was never an amount, rather than guessing', () => {
    expect(() => sum(['1.00', 'NaN'])).toThrow(RangeError)
    expect(() => add('1.00', '')).toThrow(RangeError)
  })
})

describe('cents', () => {
  it('reads an accepted amount', () => {
    expect(cents('-12.35')).toBe(-1235)
    expect(cents('0.00')).toBe(0)
  })

  it('throws on something that is not an amount', () => {
    expect(() => cents('abc')).toThrow(RangeError)
  })
})
