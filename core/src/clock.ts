// The hybrid logical clock that hands out versions. It is wall time while clocks behave, and a
// counter when they don't: when two writes land in the same millisecond, or when the wall clock
// jumps backwards. Kulkarni et al., "Logical Physical Clocks" (2014), is the algorithm.
//
// Both functions are pure. Neither reads the time: the caller passes `now`, so a test can freeze
// it, run it backwards or jump it ahead. Neither keeps state: the caller holds the clock and
// stores the one each call returns.

import { failure, type Outcome } from './outcome'
import { MAX_COUNTER, type Version } from './version'

/** The last version this device issued or saw, without a device id. */
export type Clock = { wallMs: number; counter: number }

/**
 * How far ahead of this device's clock a received version may be: five minutes.
 *
 * Without a limit, one device whose clock says 2030 would win every merge until 2030 and drag
 * every clock that hears from it to 2030 too, and nothing could ever undo it. Five minutes is
 * far more than honest clocks disagree by (NTP keeps them within a second or so; a phone that
 * has been offline for weeks drifts by seconds), and small enough that a wrong clock is caught
 * the first time it syncs.
 *
 * A refusal means the document isn't applied. Sync will tell the user that a device's clock is
 * wrong and needs fixing, and nothing is lost: the document can be received again once it is.
 */
export const MAX_DRIFT_MS = 5 * 60 * 1000

/**
 * A local write. Returns the clock to keep and the version to stamp on the document, which is
 * later than every version this clock has issued or seen.
 */
export function tick(
  clock: Clock,
  now: number,
  deviceId: string,
): Outcome<{ clock: Clock; version: Version }> {
  // If the wall clock went backwards, `max` keeps time from going back with it, and the counter
  // carries the order instead.
  const wallMs = Math.max(clock.wallMs, now)
  const counter = wallMs === clock.wallMs ? clock.counter + 1 : 0
  if (counter > MAX_COUNTER) return failure('CLOCK_COUNTER_OVERFLOW', { wallMs })
  return { ok: true, value: { clock: { wallMs, counter }, version: { wallMs, counter, deviceId } } }
}

/**
 * A document arrived from another device. Returns the clock moved past its version, so the next
 * local `tick` beats what just arrived, even if this device's clock runs behind the sender's.
 */
export function receive(clock: Clock, remote: Version, now: number): Outcome<Clock> {
  if (remote.wallMs > now + MAX_DRIFT_MS) {
    return failure('CLOCK_DRIFT', { remoteWallMs: remote.wallMs, now })
  }
  const wallMs = Math.max(clock.wallMs, remote.wallMs, now)
  const counter = nextCounter(clock, remote, wallMs)
  if (counter > MAX_COUNTER) return failure('CLOCK_COUNTER_OVERFLOW', { wallMs })
  return { ok: true, value: { wallMs, counter } }
}

// Whichever of the local and the remote clock reached the new wall time, its counter moves on by
// one; if both did, the larger one does. If `now` is ahead of both, time itself moved on and the
// counter starts again.
function nextCounter(clock: Clock, remote: Version, wallMs: number): number {
  const local = wallMs === clock.wallMs
  const theirs = wallMs === remote.wallMs
  if (local && theirs) return Math.max(clock.counter, remote.counter) + 1
  if (local) return clock.counter + 1
  if (theirs) return remote.counter + 1
  return 0
}
