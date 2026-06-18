/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import { parseHapticsEnabled } from './haptics-prefs'

describe('parseHapticsEnabled', () => {
  it('defaults to enabled when unset', () => {
    expect(parseHapticsEnabled(null)).toBe(true)
  })

  it('is enabled for the stored "true"', () => {
    expect(parseHapticsEnabled('true')).toBe(true)
  })

  it('is disabled only for the stored "false"', () => {
    expect(parseHapticsEnabled('false')).toBe(false)
  })

  it('treats unknown values as enabled (fail safe to on)', () => {
    expect(parseHapticsEnabled('garbage')).toBe(true)
  })
})
