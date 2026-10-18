import { describe, expect, it } from 'vitest'
import { type Clock, MAX_DRIFT_MS, receive, tick } from './clock'
import type { Outcome } from './outcome'
import { compareVersions, MAX_COUNTER, type Version } from './version'

const NOON = Date.UTC(2026, 9, 4, 12)
const HERE = 'a1b2c3d4e5f60718'
const THERE = 'f0e1d2c3b4a59687'

/** The value of an outcome that must be ok; fails the test with the refusal if it isn't. */
function ok<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`refused: ${JSON.stringify(outcome.failure)}`)
  return outcome.value
}

/** Ticks once per `now`, in order, and returns every version issued. */
function tickThrough(clock: Clock, nows: number[]): Version[] {
  const versions: Version[] = []
  let current = clock
  for (const now of nows) {
    const next = ok(tick(current, now, HERE))
    versions.push(next.version)
    current = next.clock
  }
  return versions
}

function expectStrictlyIncreasing(versions: Version[]) {
  for (let i = 1; i < versions.length; i++) {
    expect(compareVersions(versions[i - 1] as Version, versions[i] as Version)).toBe(-1)
  }
}

describe('tick', () => {
  it('takes the wall time and restarts the counter when time moves forward', () => {
    expect(ok(tick({ wallMs: NOON, counter: 7 }, NOON + 5, HERE))).toStrictEqual({
      clock: { wallMs: NOON + 5, counter: 0 },
      version: { wallMs: NOON + 5, counter: 0, deviceId: HERE },
    })
  })

  it('counts up when time is frozen', () => {
    expect(ok(tick({ wallMs: NOON, counter: 7 }, NOON, HERE))).toStrictEqual({
      clock: { wallMs: NOON, counter: 8 },
      version: { wallMs: NOON, counter: 8, deviceId: HERE },
    })
  })

  it('keeps its own time and counts up when the wall clock goes backwards', () => {
    expect(ok(tick({ wallMs: NOON, counter: 7 }, NOON - 60_000, HERE))).toStrictEqual({
      clock: { wallMs: NOON, counter: 8 },
      version: { wallMs: NOON, counter: 8, deviceId: HERE },
    })
  })

  it('gives 1,000 strictly increasing versions with time frozen', () => {
    const versions = tickThrough({ wallMs: NOON, counter: 0 }, Array(1000).fill(NOON))
    expect(versions).toHaveLength(1000)
    expectStrictlyIncreasing(versions)
  })

  it('gives strictly increasing versions with time running backwards', () => {
    const nows = Array.from({ length: 1000 }, (_, i) => NOON - i * 37)
    expectStrictlyIncreasing(tickThrough({ wallMs: 0, counter: 0 }, nows))
  })

  it('does not change the clock it was given', () => {
    const clock = Object.freeze({ wallMs: NOON, counter: 3 })
    tick(clock, NOON, HERE)
    tick(clock, NOON + 1, HERE)
    expect(clock).toStrictEqual({ wallMs: NOON, counter: 3 })
  })
})

describe('receive', () => {
  // One test per row of the counter rule: which of the local clock, the remote version and
  // `now` holds the latest wall time decides which counter moves on.

  it('takes the larger counter plus one when local and remote share the latest time', () => {
    const clock = { wallMs: NOON, counter: 3 }
    const remote = { wallMs: NOON, counter: 9, deviceId: THERE }
    expect(ok(receive(clock, remote, NOON - 1000))).toStrictEqual({ wallMs: NOON, counter: 10 })
    const behind = { ...remote, counter: 1 }
    expect(ok(receive(clock, behind, NOON - 1000))).toStrictEqual({ wallMs: NOON, counter: 4 })
  })

  it('moves the local counter on when the local clock is latest', () => {
    const clock = { wallMs: NOON, counter: 3 }
    const remote = { wallMs: NOON - 5, counter: 9, deviceId: THERE }
    expect(ok(receive(clock, remote, NOON - 10))).toStrictEqual({ wallMs: NOON, counter: 4 })
  })

  it('moves the remote counter on when the remote version is latest', () => {
    const clock = { wallMs: NOON - 5, counter: 3 }
    const remote = { wallMs: NOON, counter: 9, deviceId: THERE }
    expect(ok(receive(clock, remote, NOON - 10))).toStrictEqual({ wallMs: NOON, counter: 10 })
  })

  it('takes the wall time and restarts the counter when now is ahead of both', () => {
    const clock = { wallMs: NOON - 5, counter: 3 }
    const remote = { wallMs: NOON - 10, counter: 9, deviceId: THERE }
    expect(ok(receive(clock, remote, NOON))).toStrictEqual({ wallMs: NOON, counter: 0 })
  })

  // The one that matters: a device whose clock runs behind still writes a version that beats
  // what it just received, so its edit wins instead of vanishing under an older one.
  it('lets the next tick beat a remote version ahead of local time', () => {
    const clock = { wallMs: NOON, counter: 0 }
    const remote = { wallMs: NOON + 60_000, counter: 4, deviceId: '0000000000000000' }
    const after = ok(receive(clock, remote, NOON))
    const { version } = ok(tick(after, NOON + 1, 'ffffffffffffffff'))
    expect(compareVersions(version, remote)).toBe(1)
    // It beats it on the counter, not on the device id: the lowest id still wins.
    const { version: low } = ok(tick(after, NOON + 1, '0000000000000000'))
    expect(compareVersions(low, remote)).toBe(1)
  })

  it('does not change the clock or the version it was given', () => {
    const clock = Object.freeze({ wallMs: NOON, counter: 3 })
    const remote = Object.freeze({ wallMs: NOON, counter: 9, deviceId: THERE })
    receive(clock, remote, NOON)
    expect(clock).toStrictEqual({ wallMs: NOON, counter: 3 })
    expect(remote).toStrictEqual({ wallMs: NOON, counter: 9, deviceId: THERE })
  })
})

describe('the guards', () => {
  const clock = { wallMs: NOON, counter: 0 }

  it('accepts a remote version exactly MAX_DRIFT_MS ahead', () => {
    const remote = { wallMs: NOON + MAX_DRIFT_MS, counter: 0, deviceId: THERE }
    expect(receive(clock, remote, NOON).ok).toBe(true)
  })

  it('refuses a remote version one millisecond further ahead as CLOCK_DRIFT', () => {
    const remote = { wallMs: NOON + MAX_DRIFT_MS + 1, counter: 0, deviceId: THERE }
    expect(receive(clock, remote, NOON)).toStrictEqual({
      ok: false,
      failure: {
        code: 'CLOCK_DRIFT',
        details: { remoteWallMs: NOON + MAX_DRIFT_MS + 1, now: NOON },
      },
    })
  })

  it('ticks to MAX_COUNTER, then refuses with time frozen', () => {
    const last = ok(tick({ wallMs: NOON, counter: MAX_COUNTER - 1 }, NOON, HERE))
    expect(last.version.counter).toBe(MAX_COUNTER)
    expect(tick(last.clock, NOON, HERE)).toStrictEqual({
      ok: false,
      failure: { code: 'CLOCK_COUNTER_OVERFLOW', details: { wallMs: NOON } },
    })
  })

  it('refuses a receive that would push either counter past MAX_COUNTER', () => {
    const overflow = {
      ok: false,
      failure: { code: 'CLOCK_COUNTER_OVERFLOW', details: { wallMs: NOON } },
    }
    const full = { wallMs: NOON, counter: MAX_COUNTER }
    const behind = { wallMs: NOON - 1, counter: 0, deviceId: THERE }
    expect(receive(full, behind, NOON - 1)).toStrictEqual(overflow)
    const fullRemote = { wallMs: NOON, counter: MAX_COUNTER, deviceId: THERE }
    expect(receive({ wallMs: NOON - 1, counter: 0 }, fullRemote, NOON - 1)).toStrictEqual(overflow)
    expect(receive({ wallMs: NOON, counter: 0 }, fullRemote, NOON - 1)).toStrictEqual(overflow)
  })

  it('recovers from a full counter once time moves on', () => {
    const full = { wallMs: NOON, counter: MAX_COUNTER }
    expect(ok(tick(full, NOON + 1, HERE)).clock).toStrictEqual({ wallMs: NOON + 1, counter: 0 })
  })
})

describe('the clock, over a long run', () => {
  // Two devices with clocks a minute apart that jitter and sometimes jump back, writing and
  // swapping versions in a fixed pseudo-random order. Every version either one issues must beat
  // everything that device has issued or received before.
  it('never issues a version at or below one it issued or received', () => {
    let seed = 42
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const devices = [
      { id: HERE, skew: 0, clock: { wallMs: 0, counter: 0 }, latest: [] as Version[] },
      { id: THERE, skew: -60_000, clock: { wallMs: 0, counter: 0 }, latest: [] as Version[] },
    ]
    let time = NOON
    let issued = 0
    for (let step = 0; step < 5000; step++) {
      time += Math.floor(next() * 20) - 4 // mostly forward, sometimes backward, often frozen
      const device = devices[step % 2 === 0 ? 0 : 1] as (typeof devices)[number]
      const other = devices[step % 2 === 0 ? 1 : 0] as (typeof devices)[number]
      const now = time + device.skew
      const seen = device.latest.at(-1)
      const { clock, version } = ok(tick(device.clock, now, device.id))
      if (seen) expect(compareVersions(version, seen)).toBe(1)
      device.clock = clock
      device.latest.push(version)
      issued++
      if (next() < 0.3) {
        // The other device receives it; its next version must beat this one too.
        other.clock = ok(receive(other.clock, version, time + other.skew))
        other.latest.push(version)
        other.latest.sort(compareVersions)
      }
    }
    expect(issued).toBe(5000)
  })
})
