import { describe, expect, test } from 'vitest'
import {
  amountsText,
  bandDay,
  day,
  dayOf,
  dayParts,
  moment,
  money,
  moneyParts,
  todayIn,
  understood,
} from './format'

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

  test('in pieces, the year apart for the date list', () => {
    expect(dayParts('2026-11-05')).toEqual({
      weekday: 'Thu',
      day: '5',
      month: 'Nov',
      year: '2026',
    })
  })
})

describe('a moment', () => {
  test('the day, the year and the time, in the zone I am in', () => {
    const at = Date.UTC(2026, 10, 5, 12, 40)
    expect(moment(at, 'UTC')).toBe('Thu 5 Nov 2026, 12:40')
    expect(moment(at, 'America/Toronto')).toBe('Thu 5 Nov 2026, 07:40')
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

test('what the field understood is the date it means, for a Day to show', () => {
  expect(understood('10-31', TODAY)).toBe('2026-10-31')
  expect(understood('-3', TODAY)).toBe('2026-11-01')
  expect(understood('12-25', TODAY)).toBe('2025-12-25')
})

test('nothing typed, or nothing it can read, understands nothing', () => {
  expect(understood('', TODAY)).toBeNull()
  expect(understood('soon', TODAY)).toBeNull()
})

describe('the parts of an amount, for Money', () => {
  test('a spend has no sign; money in has +; a transfer has ⇄', () => {
    expect(moneyParts('16.76', 'CAD')).toEqual({ sign: null, figure: '16.76', code: null })
    expect(moneyParts('40.00', 'CAD', { way: 'in' })).toEqual({
      sign: '+',
      figure: '40.00',
      code: null,
    })
    expect(moneyParts('200.00', 'CAD', { way: 'between' })).toEqual({
      sign: '⇄',
      figure: '200.00',
      code: null,
    })
  })

  test('the code apart from the figure, so it can be small and quiet', () => {
    expect(moneyParts('35.00', 'EUR')).toEqual({ sign: null, figure: '35.00', code: 'EUR' })
    expect(moneyParts('-32.69', 'CAD', { code: true })).toEqual({
      sign: null,
      figure: '−32.69',
      code: 'CAD',
    })
  })
})

describe("a day band's day", () => {
  test('today and yesterday say so before the day', () => {
    expect(bandDay(TODAY, TODAY)).toEqual({ lead: 'today', day: 'Wed 4 Nov' })
    expect(bandDay('2026-11-03', TODAY)).toEqual({ lead: 'yesterday', day: 'Tue 3 Nov' })
  })

  test('any other day is the day alone, with its year when it isn’t this one', () => {
    expect(bandDay('2026-11-02', TODAY)).toEqual({ lead: null, day: 'Mon 2 Nov' })
    expect(bandDay('2026-11-05', TODAY)).toEqual({ lead: null, day: 'Thu 5 Nov' })
    expect(bandDay('2025-12-31', '2026-01-01')).toEqual({
      lead: 'yesterday',
      day: 'Wed 31 Dec 2025',
    })
  })
})
