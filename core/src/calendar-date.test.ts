import { describe, expect, it } from 'vitest'
import { CALENDAR_DATE, calendarDateAt, isCalendarDate } from './calendar-date'

describe('isCalendarDate', () => {
  it('accepts a real day and refuses anything else', () => {
    expect(isCalendarDate('2026-09-12')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    for (const s of [
      '2026-02-29',
      '2026-02-30',
      '2026-13-01',
      '2026-9-12',
      '2026-09-12T00:00',
      '',
    ]) {
      expect(isCalendarDate(s)).toBe(false)
    }
    expect(CALENDAR_DATE.test('2026-02-30')).toBe(true)
  })
})

describe('calendarDateAt', () => {
  // 2026-11-01 03:30 UTC: still Halloween on the west coast, already November in Tokyo.
  const now = Date.UTC(2026, 10, 1, 3, 30)

  it('gives the day it is where the time zone says', () => {
    expect(calendarDateAt(now, 'UTC')).toBe('2026-11-01')
    expect(calendarDateAt(now, 'America/Vancouver')).toBe('2026-10-31')
    expect(calendarDateAt(now, 'Asia/Tokyo')).toBe('2026-11-01')
  })

  it('turns over at local midnight, not UTC midnight', () => {
    const lastMs = Date.UTC(2026, 10, 1, 6, 59, 59, 999) // 23:59:59.999 in Vancouver (PDT)
    expect(calendarDateAt(lastMs, 'America/Vancouver')).toBe('2026-10-31')
    expect(calendarDateAt(lastMs + 1, 'America/Vancouver')).toBe('2026-11-01')
  })

  it('pads the month and day, and gives a real day', () => {
    const jan5 = Date.UTC(2026, 0, 5, 12)
    expect(calendarDateAt(jan5, 'UTC')).toBe('2026-01-05')
    expect(isCalendarDate(calendarDateAt(Date.UTC(2024, 1, 29, 12), 'UTC'))).toBe(true)
  })
})
