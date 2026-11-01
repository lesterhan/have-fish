import { describe, expect, it } from 'vitest'
import { decide } from './decide'
import type { Version } from './version'

const NOON = Date.UTC(2026, 9, 29, 12)
const OLDER: Version = { wallMs: NOON, counter: 0, deviceId: 'a1b2c3d4e5f60718' }
const NEWER: Version = { ...OLDER, counter: 1 }

describe('decide', () => {
  it('writes when nothing is stored', () => {
    expect(decide(null, OLDER)).toBe('write')
  })

  it('writes a newer version over an older one', () => {
    expect(decide(OLDER, NEWER)).toBe('write')
  })

  it('calls an equal version the same', () => {
    expect(decide(OLDER, { ...OLDER })).toBe('same')
  })

  it('calls an older version stale', () => {
    expect(decide(NEWER, OLDER)).toBe('stale')
  })

  it('breaks a tie in wall time and counter by device id, the same way on both sides', () => {
    const theirs: Version = { ...OLDER, deviceId: 'f0e1d2c3b4a59687' }
    expect(decide(OLDER, theirs)).toBe('write')
    expect(decide(theirs, OLDER)).toBe('stale')
  })
})
