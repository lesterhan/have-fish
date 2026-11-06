import { describe, expect, test } from 'vitest'
import { amountsText, day, dayOf, money, todayIn, understood } from './format'

describe('money', () => {
  test("grouped by thousands, with its currency's own decimals", () => {
    expect(money('1500.00', 'JPY')).toBe('1,500 JPY')
    expect(money('1234.50', 'CAD')).toBe('1,234.50')
    expect(money('1234567.05', 'EUR')).toBe('1,234,567.05 EUR')
  })

  test('the home currency goes unsaid, unless its code is asked for', () => {
    expect(money('1234.50', 'CAD', { code: true })).toBe('1,234.50 CAD')
    expect(money('4.50', 'CAD')).toBe('4.50')
  })

  test('a true minus', () => {
    expect(money('-32.69', 'CAD')).toBe('−32.69')
    expect(money('-1500.00', 'KRW')).toBe('−1,500 KRW')
  })

  test('zero, and the cents a whole currency had before it was whole, are shown as they are', () => {
    expect(money('0.00', 'CAD')).toBe('0.00')
    expect(money('1500.50', 'JPY')).toBe('1,500.5 JPY')
  })

  test('the largest amount a posting can carry keeps every digit', () => {
    expect(money('9999999999.99', 'CAD')).toBe('9,999,999,999.99')
  })
})

describe('day', () => {
  test('the day of the week, the day and the month, this year', () => {
    expect(day('2026-11-05', '2026-11-06')).toBe('Thu 5 Nov')
  })

  test("with the year when it isn't this one", () => {
    expect(day('2025-11-05', '2026-11-06')).toBe('Wed 5 Nov 2025')
    expect(day('2026-11-05', '2027-01-02')).toBe('Thu 5 Nov 2026')
  })
})

test('an amount with its currency', () => {
  expect(amountsText([{ amount: '4.50', currency: 'USD' }])).toBe('4.50 USD')
  expect(amountsText([{ amount: '4.50', currency: 'CAD' }])).toBe('4.50')
  expect(amountsText([{ amount: '4.50', currency: 'CAD' }], { code: true })).toBe('4.50 CAD')
})

test('several, one after the other', () => {
  expect(
    amountsText([
      { amount: '10.00', currency: 'CAD' },
      { amount: '1100.00', currency: 'JPY' },
    ]),
  ).toBe('10.00 · 1,100 JPY')
})

test('none is empty', () => {
  expect(amountsText([])).toBe('')
})

test('today is the day it is where I am, not in UTC', () => {
  const late = Date.UTC(2026, 9, 30, 3)
  expect(todayIn(late, 'America/Vancouver')).toBe('2026-10-29')
  expect(todayIn(late, 'UTC')).toBe('2026-10-30')
})

// A Wednesday.
const TODAY = '2026-11-04'

test('a day typed the short way goes as its date; what it can’t read goes as typed', () => {
  expect(dayOf('y', TODAY)).toBe('2026-11-03')
  expect(dayOf(' 2026-10-31 ', TODAY)).toBe('2026-10-31')
  expect(dayOf(' next week ', TODAY)).toBe('next week')
  expect(dayOf('', TODAY)).toBe('')
})

test('what the field understood reads as a day, with the year when it isn’t this one', () => {
  expect(understood('10-31', TODAY)).toBe('Sat 31 Oct')
  expect(understood('-3', TODAY)).toBe('Sun 1 Nov')
  expect(understood('12-25', TODAY)).toBe('Thu 25 Dec 2025')
  expect(understood('2027-01-01', TODAY)).toBe('Fri 1 Jan 2027')
})

test('nothing typed, or nothing it can read, understands nothing', () => {
  expect(understood('', TODAY)).toBeNull()
  expect(understood('soon', TODAY)).toBeNull()
})
