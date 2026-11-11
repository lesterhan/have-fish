import { calendarDateAt } from '@have-fish/core/calendar-date'
import { describe, expect, test } from 'vitest'
import { EMPTY, noonOf, SCENE_TODAY } from './fixture'

describe('noonOf', () => {
  test('is that day at noon, on this machine', () => {
    const noon = noonOf(SCENE_TODAY)
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(calendarDateAt(noon, here)).toBe(SCENE_TODAY)
    expect(new Date(noon).getHours()).toBe(12)
  })
})

describe('EMPTY', () => {
  test('holds nothing', () => {
    expect(EMPTY.rows).toEqual([])
    expect(EMPTY.days).toEqual([])
    expect(EMPTY.nets).toEqual([])
    expect(EMPTY.accounts).toEqual([])
    expect(EMPTY.paths).toEqual([])
    expect(EMPTY.assumedFrom).toBeNull()
    expect(EMPTY.reports).toEqual({})
  })
})
