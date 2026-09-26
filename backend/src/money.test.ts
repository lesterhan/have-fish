import { describe, expect, it } from 'bun:test'
import { add, format, neg, parse, splitByWeights, sub, sum } from './money'

describe('parse', () => {
  it('reads the amounts the ledger stores', () => {
    expect(parse('12.34')).toBe(1234)
    expect(parse('-12.34')).toBe(-1234)
    expect(parse('0.00')).toBe(0)
    expect(parse('9999999999.99')).toBe(999999999999)
  })

  it('reads every other shape a numeric column accepts', () => {
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

  // Postgres rounds numeric(12,2) half away from zero; these are the values it stored for
  // the same strings when this module was written.
  it('rounds to the cent the way the column does', () => {
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

  it('refuses what the column could not hold', () => {
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

  // A balance can pass the column's own limit even though no posting does; Postgres' SUM is
  // unbounded and so is this, up to exact integers.
  it('sums past what one posting could hold', () => {
    expect(sum(['9999999999.99', '9999999999.99'])).toBe('19999999999.98')
  })

  it('throws on something that was never an amount, rather than guessing', () => {
    expect(() => sum(['1.00', 'NaN'])).toThrow(RangeError)
    expect(() => add('1.00', '')).toThrow(RangeError)
  })
})

describe('splitByWeights', () => {
  it('splits evenly when it can', () => {
    expect(splitByWeights('90.00', [1, 1, 1])).toEqual(['30.00', '30.00', '30.00'])
  })

  // things-missed M2: 100.00 three ways must add back to 100.00, so settling every share
  // leaves exactly zero.
  it('gives the leftover cent to one share, and the shares add up to the amount', () => {
    const shares = splitByWeights('100.00', [1, 1, 1])
    expect(shares).toEqual(['33.34', '33.33', '33.33'])
    expect(sum(shares)).toBe('100.00')
    expect(sub('100.00', sum(shares))).toBe('0.00')
  })

  it('gives the leftover to the share it is told to', () => {
    expect(splitByWeights('100.00', [1, 1, 1], 2)).toEqual(['33.33', '33.33', '33.34'])
  })

  it('takes a cent back from that share when rounding overshoots', () => {
    // 0.05 two ways rounds to 0.03 each (half away from zero); the remainder is -0.01.
    expect(splitByWeights('0.05', [1, 1], 1)).toEqual(['0.03', '0.02'])
  })

  it('splits by unequal weights', () => {
    expect(splitByWeights('10.00', [2, 1, 1])).toEqual(['5.00', '2.50', '2.50'])
    expect(splitByWeights('10.00', [1, 2])).toEqual(['3.33', '6.67'])
  })

  it('keeps the sign of a negative amount, and rounds symmetrically', () => {
    expect(splitByWeights('-100.00', [1, 1, 1])).toEqual(['-33.34', '-33.33', '-33.33'])
    expect(splitByWeights('-0.05', [1, 1], 1)).toEqual(['-0.03', '-0.02'])
  })

  it('gives a zero weight a zero share', () => {
    expect(splitByWeights('10.00', [1, 0, 1])).toEqual(['5.00', '0.00', '5.00'])
  })

  it('always adds back to the amount', () => {
    for (const amount of ['0.01', '0.07', '1.00', '99.99', '123.45', '-47.11']) {
      for (const weights of [
        [1, 1, 1],
        [3, 2, 2],
        [1, 1, 1, 1, 1, 1, 1],
        [0.3, 0.7],
      ]) {
        expect(sum(splitByWeights(amount, weights))).toBe(format(parse(amount) ?? Number.NaN))
      }
    }
  })

  it('refuses a split that has no answer', () => {
    expect(() => splitByWeights('1.00', [])).toThrow(RangeError)
    expect(() => splitByWeights('1.00', [0, 0])).toThrow(RangeError)
    expect(() => splitByWeights('1.00', [1, -1])).toThrow(RangeError)
    expect(() => splitByWeights('1.00', [1, Number.NaN])).toThrow(RangeError)
    expect(() => splitByWeights('1.00', [1, 1], 2)).toThrow(RangeError)
  })
})
