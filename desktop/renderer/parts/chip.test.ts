import { describe, expect, test } from 'vitest'
import { chipKey } from './chip'

describe("a chip's keys", () => {
  test('Enter saves, Escape puts back', () => {
    expect(chipKey({ key: 'Enter', defaultPrevented: false })).toBe('commit')
    expect(chipKey({ key: 'Escape', defaultPrevented: false })).toBe('cancel')
  })

  test('a key its editor took is not its own', () => {
    expect(chipKey({ key: 'Enter', defaultPrevented: true })).toBeNull()
    expect(chipKey({ key: 'Escape', defaultPrevented: true })).toBeNull()
  })

  test('other keys are left alone', () => {
    expect(chipKey({ key: 'Tab', defaultPrevented: false })).toBeNull()
    expect(chipKey({ key: 'a', defaultPrevented: false })).toBeNull()
  })
})
