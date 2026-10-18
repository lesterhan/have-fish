// A version says when a document was written, so that two devices holding different copies of
// it agree on which is newer without talking to each other. It is a hybrid logical clock
// reading (see `clock.ts`): wall time, a counter for when wall time doesn't move forward, and
// the device id as the final tie-break.

import { z } from 'zod'
import { failure, type Outcome } from './outcome'

export type Version = {
  /** UTC milliseconds since 1970, up to the last millisecond of the year 9999. */
  wallMs: number
  /** Orders versions that share a `wallMs`: 0 to `MAX_COUNTER`. */
  counter: number
  /** The device that wrote it: 16 lowercase hex characters. */
  deviceId: string
}

/** The largest counter: four hex digits, the width of its text form. */
export const MAX_COUNTER = 0xffff

/**
 * The last millisecond of 9999-12-31. Past it, `toISOString` writes a six-digit year with a sign
 * (`+010000-…`), the text form stops being fixed-width, and sorting the text would no longer
 * sort the versions. No device clock gets there, so a version past it is malformed.
 */
export const MAX_WALL_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999)

const DEVICE_ID = /^[0-9a-f]{16}$/

export const VersionSchema = z.strictObject({
  wallMs: z.int().min(0).max(MAX_WALL_MS),
  counter: z.int().min(0).max(MAX_COUNTER),
  deviceId: z.string().regex(DEVICE_ID),
})

/**
 * Orders two versions: by `wallMs`, then `counter`, then `deviceId`. Two devices never share an
 * id, so `0` means the same event. Comparing ids with `<` is safe because they are always
 * lowercase hex, where string order is the order of the characters.
 */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  return 0
}

/**
 * The text form, `2026-10-04T12:00:00.000Z-0000-a1b2c3d4e5f60718`: the ISO time, the counter as
 * four hex digits, then the device id. Every part has a fixed width, so sorting the strings
 * sorts the versions, which lets SQLite order by a text column.
 *
 * It throws on a version outside `VersionSchema`, because that text would sort wrongly. Every
 * version from `tick`, `receive`, `parseVersion` or `readVersioned` is inside it, so a throw here
 * is a bug in the caller, not bad input.
 */
export function formatVersion(v: Version): string {
  if (!VersionSchema.safeParse(v).success) {
    throw new RangeError(`not a version: ${JSON.stringify(v)}`)
  }
  const time = new Date(v.wallMs).toISOString()
  const counter = v.counter.toString(16).padStart(4, '0')
  return `${time}-${counter}-${v.deviceId}`
}

// The exact shape `formatVersion` writes. Anything looser (a five-digit counter, uppercase hex,
// a time without milliseconds or zone) is refused rather than read generously, because a
// version that doesn't print back as the same text would sort in the wrong place.
const VERSION_TEXT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([0-9a-f]{16})$/

/** Reads the text form back. Refuses anything `formatVersion` would not have written. */
export function parseVersion(text: string): Outcome<Version> {
  const match = VERSION_TEXT.exec(text)
  if (!match) return failure('VERSION_MALFORMED', { path: '', issue: 'invalid_format' })
  const [, time = '', counter = '', deviceId = ''] = match

  // A time with the right shape can still name no real moment (`2026-02-30`, `25:00`). Such a
  // time either fails to parse or rolls over, and then prints back as different text.
  const wallMs = new Date(time).getTime()
  if (Number.isNaN(wallMs) || new Date(wallMs).toISOString() !== time) {
    return failure('VERSION_MALFORMED', { path: 'wallMs', issue: 'invalid_date' })
  }
  return { ok: true, value: { wallMs, counter: Number.parseInt(counter, 16), deviceId } }
}
