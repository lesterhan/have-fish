import { expect, test } from 'vitest'
import { amountsText, dayOf, todayIn, understood } from './format'

test('an amount with its currency', () => {
  expect(amountsText([{ amount: '4.50', currency: 'CAD' }])).toBe('4.50 CAD')
})

test('several, one after the other', () => {
  expect(
    amountsText([
      { amount: '10.00', currency: 'CAD' },
      { amount: '1100.00', currency: 'JPY' },
    ]),
  ).toBe('10.00 CAD · 1100.00 JPY')
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
