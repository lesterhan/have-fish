// Hybrid logical clock (Kulkarni et al., 2014): wall time when clocks behave, a counter when
// they don't. Pure: the caller passes `now` and keeps the returned clock.

import { failure, type Outcome } from './outcome'
import { MAX_COUNTER, type Version } from './version'

/** The latest version this device issued or saw, minus the device id. */
export type Clock = { wallMs: number; counter: number }

/**
 * How far ahead of `now` a received version may be.
 *
 * Without a limit, a device whose clock says 2030 would win every merge and drag every other
 * clock to 2030. Five minutes is well above normal clock skew. A refusal means the document
 * isn't applied, and sync tells the user that a device's clock is wrong.
 */
export const MAX_DRIFT_MS = 5 * 60 * 1000

/** A local write: the next clock, and the version to stamp on the document. */
export function tick(
  clock: Clock,
  now: number,
  deviceId: string,
): Outcome<{ clock: Clock; version: Version }> {
  // `max` stops time going backwards; the counter keeps the order.
  const wallMs = Math.max(clock.wallMs, now)
  const counter = wallMs === clock.wallMs ? clock.counter + 1 : 0
  if (counter > MAX_COUNTER) return failure('CLOCK_COUNTER_OVERFLOW', { wallMs })
  return { ok: true, value: { clock: { wallMs, counter }, version: { wallMs, counter, deviceId } } }
}

/** A remote version arrived. Moves the clock past it, so the next `tick` beats it. */
export function receive(clock: Clock, remote: Version, now: number): Outcome<Clock> {
  if (remote.wallMs > now + MAX_DRIFT_MS) {
    return failure('CLOCK_DRIFT', { remoteWallMs: remote.wallMs, now })
  }
  const wallMs = Math.max(clock.wallMs, remote.wallMs, now)
  const counter = nextCounter(clock, remote, wallMs)
  if (counter > MAX_COUNTER) return failure('CLOCK_COUNTER_OVERFLOW', { wallMs })
  return { ok: true, value: { wallMs, counter } }
}

// Bump the counter of whichever side reached `wallMs` (the larger, if both).
// If `now` passed them both, start again at 0.
function nextCounter(clock: Clock, remote: Version, wallMs: number): number {
  const local = wallMs === clock.wallMs
  const theirs = wallMs === remote.wallMs
  if (local && theirs) return Math.max(clock.counter, remote.counter) + 1
  if (local) return clock.counter + 1
  if (theirs) return remote.counter + 1
  return 0
}
