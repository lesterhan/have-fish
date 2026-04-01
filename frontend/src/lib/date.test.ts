/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { toISODate, parseCustomDateRange } from './date'

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
      to: toISODate(today)
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
      to: toISODate(today)
    })
    expect(parseCustomDateRange('2 weeks')).toEqual({
      from: toISODate(twoWeeksAgo),
      to: toISODate(today)
    })
    expect(parseCustomDateRange('3w')).toEqual({
      from: toISODate(threeWeeksAgo),
      to: toISODate(today)
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
      to: toISODate(today)
    })
    expect(parseCustomDateRange('2 months')).toEqual({
      from: toISODate(twoMonthsAgo),
      to: toISODate(today)
    })
    expect(parseCustomDateRange('3mon')).toEqual({
      from: toISODate(threeMonthsAgo),
      to: toISODate(today)
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
      to: toISODate(today)
    })
    expect(parseCustomDateRange('10 days')).toEqual({
      from: toISODate(tenDaysAgo),
      to: toISODate(today)
    })
    expect(parseCustomDateRange('20d')).toEqual({
      from: toISODate(twentyDaysAgo),
      to: toISODate(today)
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

    expect(parseCustomDateRange('Past 1 week')).toEqual({ from: toISODate(oneWeekAgo), to: toISODate(today) })
    expect(parseCustomDateRange('past 3 months')).toEqual({ from: toISODate(threeMonthsAgo), to: toISODate(today) })
    expect(parseCustomDateRange('Past 7d')).toEqual({ from: toISODate(oneWeekAgo), to: toISODate(today) })
  })

  it('parses date ranges', () => {
    const fromDate = new Date('2021-12-23')
    const toDate = new Date('2022-05-15')

    expect(parseCustomDateRange(`${toISODate(fromDate)}-${toISODate(toDate)}`)).toEqual(
      { from: toISODate(fromDate), to: toISODate(toDate) }
    )

    expect(parseCustomDateRange(`${toISODate(fromDate)} to ${toISODate(toDate)}`)).toEqual(
      { from: toISODate(fromDate), to: toISODate(toDate) }
    )
  })
})
