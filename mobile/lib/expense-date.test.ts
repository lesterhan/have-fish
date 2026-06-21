/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import {
  clampISO,
  dateLabel,
  monthDay,
  resolveDate,
  toISODate,
  todayISO,
  yesterdayISO,
} from './expense-date'

// A fixed reference "now" — mid-month, two-digit month/day, so padding bugs and
// month-boundary bugs both surface. Local time (no Z) to mirror a device clock.
const NOW = new Date(2026, 5, 18, 14, 30) // 2026-06-18

describe('toISODate', () => {
  it('formats local calendar date with zero-padding', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('uses local fields, not UTC', () => {
    // 23:30 local on the 18th stays the 18th regardless of UTC offset.
    expect(toISODate(new Date(2026, 5, 18, 23, 30))).toBe('2026-06-18')
  })
})

describe('todayISO / yesterdayISO', () => {
  it('returns the reference day', () => {
    expect(todayISO(NOW)).toBe('2026-06-18')
  })

  it('rolls back across nothing tricky', () => {
    expect(yesterdayISO(NOW)).toBe('2026-06-17')
  })

  it('rolls back across a month boundary', () => {
    expect(yesterdayISO(new Date(2026, 6, 1, 9, 0))).toBe('2026-06-30')
  })
})

describe('resolveDate', () => {
  it('today mode → today ISO', () => {
    expect(resolveDate('today', null, NOW)).toBe('2026-06-18')
  })

  it('yesterday mode → yesterday ISO', () => {
    expect(resolveDate('yesterday', null, NOW)).toBe('2026-06-17')
  })

  it('pick mode → the picked ISO', () => {
    expect(resolveDate('pick', '2026-06-10', NOW)).toBe('2026-06-10')
  })

  it('pick mode with no value falls back to today', () => {
    expect(resolveDate('pick', null, NOW)).toBe('2026-06-18')
  })

  it('blocks a future picked date by clamping to today', () => {
    expect(resolveDate('pick', '2026-12-25', NOW)).toBe('2026-06-18')
  })
})

describe('clampISO', () => {
  it('passes through a past date', () => {
    expect(clampISO('2025-01-01', NOW)).toBe('2025-01-01')
  })

  it('passes through today', () => {
    expect(clampISO('2026-06-18', NOW)).toBe('2026-06-18')
  })

  it('clamps a future date to today', () => {
    expect(clampISO('2030-01-01', NOW)).toBe('2026-06-18')
  })
})

describe('dateLabel', () => {
  it('labels today', () => {
    expect(dateLabel('2026-06-18', NOW)).toBe('Today')
  })

  it('labels yesterday', () => {
    expect(dateLabel('2026-06-17', NOW)).toBe('Yesterday')
  })

  it('shows the ISO string for older dates', () => {
    expect(dateLabel('2026-06-10', NOW)).toBe('2026-06-10')
  })
})

describe('monthDay', () => {
  it('formats a local ISO date as `Mon D`', () => {
    expect(monthDay('2026-06-18')).toBe('Jun 18')
    expect(monthDay('2026-01-01')).toBe('Jan 1')
    expect(monthDay('2026-12-31')).toBe('Dec 31')
  })

  it('does not shift the day across UTC (parses parts, not new Date)', () => {
    // A bare `new Date('2026-06-01')` is UTC midnight → May 31 for west-of-UTC.
    expect(monthDay('2026-06-01')).toBe('Jun 1')
  })

  it('returns the input unchanged when malformed', () => {
    expect(monthDay('not-a-date')).toBe('not-a-date')
    expect(monthDay('2026-13-01')).toBe('2026-13-01')
  })
})
