import { describe, expect, it } from 'vitest'
import { CALENDAR_DATE, isCalendarDate } from './calendar-date'

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
