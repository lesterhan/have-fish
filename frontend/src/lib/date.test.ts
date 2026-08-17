/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import {
  toISODate,
  parseCustomDateRange,
  defaultTransactionRange,
  parseTzOffset,
} from './date'

// Sanity check: toISODate formats a known date correctly.
describe('toISODate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(toISODate(new Date(2026, 2, 8))).toBe('2026-03-08') // month is 0-indexed
  })
})

describe('parseCustomDateRange', () => {
  it('parse single date to today', () => {
    const today = new Date()
    const twentyDaysAgo = new Date(today)
    twentyDaysAgo.setDate(today.getDate() - 20)

    expect(parseCustomDateRange(toISODate(twentyDaysAgo))).toEqual({
      from: toISODate(twentyDaysAgo),
      to: toISODate(today),
    })
  })

  it('parses weeks', () => {
    const today = new Date()
    const oneWeekAgo = new Date(today)
    oneWeekAgo.setDate(today.getDate() - 7)
    const twoWeeksAgo = new Date(today)
    twoWeeksAgo.setDate(today.getDate() - 14)
    const threeWeeksAgo = new Date(today)
    threeWeeksAgo.setDate(today.getDate() - 21)

    expect(parseCustomDateRange('1 week')).toEqual({
      from: toISODate(oneWeekAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('2 weeks')).toEqual({
      from: toISODate(twoWeeksAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('3w')).toEqual({
      from: toISODate(threeWeeksAgo),
      to: toISODate(today),
    })
  })

  it('parses months', () => {
    const today = new Date()
    const oneMonthAgo = new Date(today)
    oneMonthAgo.setDate(today.getDate() - 31)
    const twoMonthsAgo = new Date(today)
    twoMonthsAgo.setDate(today.getDate() - 62)
    const threeMonthsAgo = new Date(today)
    threeMonthsAgo.setDate(today.getDate() - 93)

    expect(parseCustomDateRange('1 mo')).toEqual({
      from: toISODate(oneMonthAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('2 months')).toEqual({
      from: toISODate(twoMonthsAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('3mon')).toEqual({
      from: toISODate(threeMonthsAgo),
      to: toISODate(today),
    })
  })

  it('parses days', () => {
    const today = new Date()
    const oneDayAgo = new Date(today)
    oneDayAgo.setDate(today.getDate() - 1)
    const tenDaysAgo = new Date(today)
    tenDaysAgo.setDate(today.getDate() - 10)
    const twentyDaysAgo = new Date(today)
    twentyDaysAgo.setDate(today.getDate() - 20)

    expect(parseCustomDateRange('1day')).toEqual({
      from: toISODate(oneDayAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('10 days')).toEqual({
      from: toISODate(tenDaysAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('20d')).toEqual({
      from: toISODate(twentyDaysAgo),
      to: toISODate(today),
    })
  })

  it('returns null for unparseable input', () => {
    expect(parseCustomDateRange('')).toBeNull()
    expect(parseCustomDateRange('last week')).toBeNull()
    expect(parseCustomDateRange('not a date')).toBeNull()
    expect(parseCustomDateRange('2026-99-99')).toBeNull()
    expect(parseCustomDateRange('2026-99-99 to 2026-01-01')).toBeNull()
    expect(parseCustomDateRange('2026-01-01 to 2026-99-99')).toBeNull()
  })

  it('accepts "past" prefix on relative shorthand', () => {
    const today = new Date()
    const oneWeekAgo = new Date(today)
    oneWeekAgo.setDate(today.getDate() - 7)
    const threeMonthsAgo = new Date(today)
    threeMonthsAgo.setDate(today.getDate() - 93)

    expect(parseCustomDateRange('Past 1 week')).toEqual({
      from: toISODate(oneWeekAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('past 3 months')).toEqual({
      from: toISODate(threeMonthsAgo),
      to: toISODate(today),
    })
    expect(parseCustomDateRange('Past 7d')).toEqual({
      from: toISODate(oneWeekAgo),
      to: toISODate(today),
    })
  })

  it('parses date ranges', () => {
    const fromDate = new Date('2021-12-23')
    const toDate = new Date('2022-05-15')

    expect(
      parseCustomDateRange(`${toISODate(fromDate)}-${toISODate(toDate)}`),
    ).toEqual({ from: toISODate(fromDate), to: toISODate(toDate) })

    expect(
      parseCustomDateRange(`${toISODate(fromDate)} to ${toISODate(toDate)}`),
    ).toEqual({ from: toISODate(fromDate), to: toISODate(toDate) })
  })
})

describe('parseTzOffset', () => {
  it('reads a numeric offset', () => {
    expect(parseTzOffset('480')).toBe(480)
    expect(parseTzOffset('-300')).toBe(-300)
    expect(parseTzOffset('0')).toBe(0)
  })

  it('falls back to UTC for a missing or unparseable value', () => {
    expect(parseTzOffset(undefined)).toBe(0)
    expect(parseTzOffset(null)).toBe(0)
    expect(parseTzOffset('')).toBe(0)
    expect(parseTzOffset('not-a-number')).toBe(0)
  })

  it('rejects offsets outside the real-world range', () => {
    expect(parseTzOffset('99999')).toBe(0)
    expect(parseTzOffset('-99999')).toBe(0)
  })
})

describe('defaultTransactionRange', () => {
  // 2026-08-17T18:30Z — evening in UTC, already the 18th in Shanghai (UTC+8).
  const evening = Date.parse('2026-08-17T18:30:00Z')
  const withNow = <T>(ms: number, fn: () => T): T => {
    const realNow = Date.now
    Date.now = () => ms
    try {
      return fn()
    } finally {
      Date.now = realNow
    }
  }

  it('ends on the viewer\'s local date, not the UTC date', () => {
    // The whole point of threading the offset through: from UTC+8 the user's "today" is
    // already the 18th, and a UTC-computed window would hide anything they filed today.
    expect(withNow(evening, () => defaultTransactionRange(480)).to).toBe('2026-08-18')
    expect(withNow(evening, () => defaultTransactionRange(0)).to).toBe('2026-08-17')
    // Behind UTC (New York, UTC-4) it is still the 17th.
    expect(withNow(evening, () => defaultTransactionRange(-240)).to).toBe('2026-08-17')
  })

  it('spans 90 days back from that local date by default', () => {
    expect(withNow(evening, () => defaultTransactionRange(480))).toEqual({
      from: '2026-05-20',
      to: '2026-08-18',
    })
  })

  it('honours a custom window length', () => {
    expect(withNow(evening, () => defaultTransactionRange(0, 30))).toEqual({
      from: '2026-07-18',
      to: '2026-08-17',
    })
  })

  it('crosses month and year boundaries correctly', () => {
    const january = Date.parse('2026-01-05T12:00:00Z')
    expect(withNow(january, () => defaultTransactionRange(0, 90))).toEqual({
      from: '2025-10-07',
      to: '2026-01-05',
    })
  })

  it('agrees with the browser when handed the browser\'s own offset', () => {
    // What the client passes: -getTimezoneOffset(). The result must be today's local
    // calendar date, i.e. exactly what toISODate would produce.
    const range = defaultTransactionRange(-new Date().getTimezoneOffset())
    expect(range.to).toBe(toISODate(new Date()))
  })
})
