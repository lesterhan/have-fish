import { describe, expect, test } from 'vitest'
import { CURRENCIES, fitsCurrency, minorUnits } from './currencies'

describe('minor units', () => {
  test('the yen, the won and the króna have none; every other currency has two', () => {
    const whole = CURRENCIES.filter((c) => minorUnits(c) === 0)
    expect(whole).toEqual(['JPY', 'KRW', 'ISK'])
    expect(minorUnits('CAD')).toBe(2)
  })

  test("a code it doesn't know has two, as storage does", () => {
    expect(minorUnits('XYZ')).toBe(2)
  })
})

describe('fitsCurrency', () => {
  test.each([
    [150000, 'JPY', true],
    [150050, 'JPY', false],
    [150001, 'KRW', false],
    [150050, 'CAD', true],
    [1, 'EUR', true],
    [-150000, 'ISK', true],
    [-150050, 'ISK', false],
  ])('%i cents in %s: %s', (cents, currency, fits) => {
    expect(fitsCurrency(cents, currency)).toBe(fits)
  })
})
