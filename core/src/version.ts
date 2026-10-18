// When a document was written, so two devices can agree which copy is newer.
// Ordered by wall time, then counter, then device id.

import { z } from 'zod'
import { failure, type Outcome } from './outcome'

export type Version = {
  /** UTC ms, 1970 to the end of 9999. */
  wallMs: number
  /** Breaks ties within one `wallMs`. 0 to `MAX_COUNTER`. */
  counter: number
  /** 16 lowercase hex characters. */
  deviceId: string
}

/** Four hex digits, the width of the text form. */
export const MAX_COUNTER = 0xffff

/** Past 9999, `toISOString` writes `+010000-…` and the text form stops sorting correctly. */
export const MAX_WALL_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999)

const DEVICE_ID = /^[0-9a-f]{16}$/

export const VersionSchema = z.strictObject({
  wallMs: z.int().min(0).max(MAX_WALL_MS),
  counter: z.int().min(0).max(MAX_COUNTER),
  deviceId: z.string().regex(DEVICE_ID),
})

// Not strict: a wider object, such as a row with more columns, is still a version.
const VersionFields = z.object(VersionSchema.shape)

/** Device ids are unique, so `0` means the same event. */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  return 0
}

/**
 * `2026-10-04T12:00:00.000Z-0000-a1b2c3d4e5f60718`. Every part is fixed-width, so sorting the
 * text sorts the versions.
 *
 * Throws on an out-of-range version: nothing in the core produces one, so it's a caller bug.
 */
export function formatVersion(v: Version): string {
  if (!VersionFields.safeParse(v).success) {
    throw new RangeError(`not a version: ${JSON.stringify(v)}`)
  }
  const time = new Date(v.wallMs).toISOString()
  const counter = v.counter.toString(16).padStart(4, '0')
  return `${time}-${counter}-${v.deviceId}`
}

// Exactly what `formatVersion` writes, nothing looser.
const VERSION_TEXT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([0-9a-f]{16})$/

export function parseVersion(text: string): Outcome<Version> {
  const match = VERSION_TEXT.exec(text)
  if (!match) return failure('VERSION_MALFORMED', { path: '', issue: 'invalid_format' })
  const [, time = '', counter = '', deviceId = ''] = match

  // Refuses times like `2026-02-30`: they roll over and print back differently.
  const wallMs = new Date(time).getTime()
  if (Number.isNaN(wallMs) || new Date(wallMs).toISOString() !== time) {
    return failure('VERSION_MALFORMED', { path: 'wallMs', issue: 'invalid_date' })
  }
  if (wallMs < 0) return failure('VERSION_MALFORMED', { path: 'wallMs', issue: 'too_small' })
  return { ok: true, value: { wallMs, counter: Number.parseInt(counter, 16), deviceId } }
}
