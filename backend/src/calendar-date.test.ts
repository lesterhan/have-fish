import { describe, expect, it } from 'bun:test'
import {
  addDays,
  CALENDAR_DATE,
  calendarDateFromText,
  calendarDateOf,
  daysBetween,
  isCalendarDate,
} from './calendar-date'

// Each zone below is one where the timestamp-column code put a row on the wrong day
// (things-missed M1): east of UTC, a local midnight is the previous day in UTC; west of it,
// a late-evening entry is the next day in UTC.
//
// Bun applies only the first change to process.env.TZ in a process and silently ignores
// the rest, so each zone runs in a child process of its own, which first reports its UTC
// offset: a zone that didn't take would fail that check rather than pass quietly in UTC.
const ZONES = {
  UTC: 0,
  'Asia/Tokyo': -540,
  'Asia/Kolkata': -330,
  'America/Los_Angeles': 480,
  'Pacific/Kiritimati': -840,
} as const

function inEachZone(expressions: string[]): Record<string, unknown[]> {
  const results: Record<string, unknown[]> = {}
  for (const [zone, offset] of Object.entries(ZONES)) {
    const code = [
      `import * as d from '${import.meta.dir}/calendar-date.ts'`,
      `console.log(JSON.stringify([new Date(2026, 0, 15).getTimezoneOffset(), ${expressions.join(', ')}]))`,
    ].join('\n')
    const run = Bun.spawnSync(['bun', '-e', code], { env: { ...process.env, TZ: zone } })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    const [actualOffset, ...values] = JSON.parse(run.stdout.toString()) as unknown[]
    expect(actualOffset, `${zone} did not take effect`).toBe(offset)
    results[zone] = values
  }
  return results
}

function sameInEveryZone(expressions: string[], expected: unknown[]) {
  for (const [zone, values] of Object.entries(inEachZone(expressions))) {
    expect(values, zone).toEqual(expected)
  }
}

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

describe('calendarDateOf', () => {
  it('keeps a calendar date, and takes the date part of a timestamp as written', () => {
    expect(calendarDateOf('2026-09-12')).toBe('2026-09-12')
    expect(calendarDateOf('2026-09-12T00:00:00.000Z')).toBe('2026-09-12')
    expect(calendarDateOf('2026-09-12T23:30:00-07:00')).toBe('2026-09-12')
    expect(calendarDateOf('2026-09-12 08:00:00')).toBe('2026-09-12')
  })

  it('is the same in every time zone', () => {
    sameInEveryZone(
      [`d.calendarDateOf('2026-09-12T23:30:00-07:00')`, `d.calendarDateOf('2026-01-01')`],
      ['2026-09-12', '2026-01-01'],
    )
  })

  it('refuses what names no day, rather than storing it', () => {
    for (const s of ['', '2026-02-30', '12/09/2026', '2026-09-12x', 'NaN']) {
      expect(() => calendarDateOf(s)).toThrow(RangeError)
    }
  })
})

describe('calendarDateFromText', () => {
  it('reads an ISO date as written, whatever time or offset follows', () => {
    sameInEveryZone(
      [
        `d.calendarDateFromText('2026-09-12')`,
        `d.calendarDateFromText(' 2026-09-12 23:45:10 ')`,
        `d.calendarDateFromText('2026-09-12T23:30:00-07:00')`,
        `d.calendarDateFromText('2026-09-12T01:00:00+09:00')`,
      ],
      ['2026-09-12', '2026-09-12', '2026-09-12', '2026-09-12'],
    )
  })

  // M1 itself: `new Date('09/12/2026').toISOString()` is 2026-09-11 in Tokyo.
  it('reads the formats banks write as the day they wrote, in every time zone', () => {
    expect(calendarDateFromText('09/12/2026')).toBe('2026-09-12')
    sameInEveryZone(
      [
        `d.calendarDateFromText('09/12/2026')`,
        `d.calendarDateFromText('Sep 12, 2026')`,
        `d.calendarDateFromText('12 Sep 2026')`,
        `d.calendarDateFromText('2026/09/12')`,
        `d.calendarDateFromText('12/31/2026')`,
      ],
      ['2026-09-12', '2026-09-12', '2026-09-12', '2026-09-12', '2026-12-31'],
    )
  })

  it('reads nothing from what is not a date', () => {
    for (const s of ['', '   ', 'yesterday', '2026-02-30', '13/45/2026']) {
      expect(calendarDateFromText(s)).toBeNull()
    }
  })
})

describe('addDays and daysBetween', () => {
  it('count whole calendar days across months, years and leap days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(daysBetween('2025-12-31', '2026-01-02')).toBe(2)
    expect(daysBetween('2026-01-02', '2025-12-31')).toBe(-2)
  })

  // A daylight-saving change is where local-time arithmetic loses or gains an hour.
  it('are not moved by a daylight-saving change', () => {
    sameInEveryZone(
      [
        `d.addDays('2026-03-08', 1)`,
        `d.daysBetween('2026-03-07', '2026-03-09')`,
        `d.daysBetween('2026-10-31', '2026-11-02')`,
      ],
      ['2026-03-09', 2, 2],
    )
  })
})
