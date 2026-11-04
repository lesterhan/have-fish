import { describe, expect, test } from 'vitest'
import { dateFrom } from './typed-date'

// A Wednesday.
const TODAY = '2026-11-04'
const read = (typed: string) => dateFrom(typed, TODAY)

describe('dateFrom', () => {
  test.each([
    ['t', '2026-11-04'],
    ['today', '2026-11-04'],
    ['y', '2026-11-03'],
    ['yesterday', '2026-11-03'],
    [' Y ', '2026-11-03'],
  ])('%j is %s', (typed, date) => {
    expect(read(typed)).toBe(date)
  })

  test.each([
    ['-0', '2026-11-04'],
    ['-1', '2026-11-03'],
    ['-3', '2026-11-01'],
    ['-10', '2026-10-25'],
    ['-365', '2025-11-04'],
  ])('%s is that many days ago: %s', (typed, date) => {
    expect(read(typed)).toBe(date)
  })

  test.each([
    ['wed', '2026-11-04'], // today is a Wednesday: today
    ['wednesday', '2026-11-04'],
    ['tue', '2026-11-03'],
    ['thu', '2026-10-29'],
    ['thurs', '2026-10-29'],
    ['Mon', '2026-11-02'],
    ['MONDAY', '2026-11-02'],
    ['sun', '2026-11-01'],
    ['sat', '2026-10-31'],
    ['fri', '2026-10-30'],
  ])('%s is the most recent one, today included: %s', (typed, date) => {
    expect(read(typed)).toBe(date)
  })

  test.each([
    ['10-31', '2026-10-31'],
    ['1-5', '2026-01-05'],
    ['11-04', '2026-11-04'],
    // Still to come this year: the most recent one, last year's. Never a future date.
    ['12-25', '2025-12-25'],
    ['11-05', '2025-11-05'],
  ])('month and day %s is %s', (typed, date) => {
    expect(read(typed)).toBe(date)
  })

  test('a full date is itself, past or future', () => {
    expect(read('2026-10-31')).toBe('2026-10-31')
    expect(read('2027-01-01')).toBe('2027-01-01')
  })

  test.each([
    '',
    'x',
    'tomorrow',
    'mo',
    '+3',
    '-',
    '-1d',
    '13-01',
    '02-30',
    '31/10',
    '10/31',
    '2026-02-30',
    '2026-1-5',
    '--3',
  ])('%j is not a date it can read', (typed) => {
    expect(read(typed)).toBeNull()
  })

  test('29 February in a year that has none, short, is the last one there was', () => {
    expect(dateFrom('2-29', '2027-03-01')).toBe('2024-02-29')
  })
})
