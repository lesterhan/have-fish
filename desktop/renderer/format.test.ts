import { expect, test } from 'vitest'
import { amountsText, todayIn } from './format'

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
