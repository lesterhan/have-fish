import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  formatVersion,
  MAX_COUNTER,
  MAX_WALL_MS,
  parseVersion,
  type Version,
} from './version'

const NOON = Date.UTC(2026, 9, 4, 12) // 2026-10-04T12:00:00.000Z
const D1 = 'a1b2c3d4e5f60718'
const D2 = 'b1b2c3d4e5f60718'

const v = (wallMs: number, counter: number, deviceId: string): Version => ({
  wallMs,
  counter,
  deviceId,
})

/** Seeded PRNG (mulberry32), so samples are the same every run. */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Crowded on purpose: many ties, so every tie-break runs, plus each field's extremes. */
function sample(seed: number, n: number): Version[] {
  const next = seeded(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T
  const walls = [0, 999, 1000, NOON - 1, NOON, NOON + 1, Date.UTC(2001, 0, 1), MAX_WALL_MS]
  const counters = [0, 1, 2, 0xf, 0x10, 0xff, 0x100, MAX_COUNTER]
  const devices = [D1, D2, '0000000000000000', 'ffffffffffffffff', '0a00000000000000']
  return Array.from({ length: n }, () =>
    v(
      next() < 0.8 ? pick(walls) : Math.floor(next() * MAX_WALL_MS),
      next() < 0.8 ? pick(counters) : Math.floor(next() * (MAX_COUNTER + 1)),
      pick(devices),
    ),
  )
}

describe('compareVersions', () => {
  it('orders by wall time first, whatever the counter and device', () => {
    expect(compareVersions(v(NOON, 9, D2), v(NOON + 1, 0, D1))).toBe(-1)
    expect(compareVersions(v(NOON + 1, 0, D1), v(NOON, 9, D2))).toBe(1)
  })

  it('orders by counter when the wall time ties, whatever the device', () => {
    expect(compareVersions(v(NOON, 1, D2), v(NOON, 2, D1))).toBe(-1)
    expect(compareVersions(v(NOON, 2, D1), v(NOON, 1, D2))).toBe(1)
  })

  it('orders by device id when wall time and counter tie', () => {
    expect(compareVersions(v(NOON, 1, D1), v(NOON, 1, D2))).toBe(-1)
    expect(compareVersions(v(NOON, 1, D2), v(NOON, 1, D1))).toBe(1)
  })

  it('is 0 only for the same version', () => {
    expect(compareVersions(v(NOON, 1, D1), v(NOON, 1, D1))).toBe(0)
  })
})

describe('formatVersion', () => {
  it('writes the ISO time, four hex digits of counter, and the device id', () => {
    expect(formatVersion(v(NOON, 0, D1))).toBe('2026-10-04T12:00:00.000Z-0000-a1b2c3d4e5f60718')
    expect(formatVersion(v(NOON, 0xabc, D1))).toBe('2026-10-04T12:00:00.000Z-0abc-a1b2c3d4e5f60718')
  })

  it('has the same width at both ends of the range', () => {
    expect(formatVersion(v(0, 0, D1))).toBe('1970-01-01T00:00:00.000Z-0000-a1b2c3d4e5f60718')
    expect(formatVersion(v(MAX_WALL_MS, MAX_COUNTER, D1))).toBe(
      '9999-12-31T23:59:59.999Z-ffff-a1b2c3d4e5f60718',
    )
  })

  it('throws on a version whose text would sort in the wrong place', () => {
    expect(() => formatVersion(v(MAX_WALL_MS + 1, 0, D1))).toThrow(RangeError)
    expect(() => formatVersion(v(-1, 0, D1))).toThrow(RangeError)
    expect(() => formatVersion(v(NOON, MAX_COUNTER + 1, D1))).toThrow(RangeError)
    expect(() => formatVersion(v(NOON, 0, 'A1B2C3D4E5F60718'))).toThrow(RangeError)
    expect(() => formatVersion(v(NOON + 0.5, 0, D1))).toThrow(RangeError)
  })
})

describe('the text form', () => {
  // Every pair, not just one sort: text order must equal version order.
  it('compares the same as compareVersions, for every pair in a sample', () => {
    const versions = sample(1, 300)
    const texts = versions.map(formatVersion)
    const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    for (let i = 0; i < versions.length; i++) {
      for (let j = 0; j < versions.length; j++) {
        const [a, b] = [versions[i] as Version, versions[j] as Version]
        expect(compareVersions(a, b)).toBe(textOrder(texts[i] ?? '', texts[j] ?? ''))
      }
    }
  })

  it('sorts into the same order as compareVersions', () => {
    for (const seed of [2, 3, 4]) {
      const versions = sample(seed, 400)
      const byCompare = [...versions].sort(compareVersions).map(formatVersion)
      const byText = versions.map(formatVersion).sort()
      expect(byText).toEqual(byCompare)
    }
  })
})

describe('parseVersion', () => {
  it('reads back what formatVersion wrote', () => {
    for (const version of sample(5, 300)) {
      expect(parseVersion(formatVersion(version))).toStrictEqual({ ok: true, value: version })
    }
  })

  it.each([
    ['a short device id', '2026-10-04T12:00:00.000Z-0000-a1b2c3d4e5f6071'],
    ['a long device id', '2026-10-04T12:00:00.000Z-0000-a1b2c3d4e5f607189'],
    ['uppercase hex in the device id', '2026-10-04T12:00:00.000Z-0000-A1B2C3D4E5F60718'],
    ['uppercase hex in the counter', '2026-10-04T12:00:00.000Z-00AB-a1b2c3d4e5f60718'],
    ['a five-digit counter', '2026-10-04T12:00:00.000Z-00000-a1b2c3d4e5f60718'],
    ['a three-digit counter', '2026-10-04T12:00:00.000Z-000-a1b2c3d4e5f60718'],
    ['a time without milliseconds', '2026-10-04T12:00:00Z-0000-a1b2c3d4e5f60718'],
    ['a time with an offset', '2026-10-04T12:00:00.000+01:00-0000-a1b2c3d4e5f60718'],
    ['a time in epoch milliseconds', '1759579200000-0000-a1b2c3d4e5f60718'],
    ['a year past 9999', '+010000-01-01T00:00:00.000Z-0000-a1b2c3d4e5f60718'],
    ['surrounding space', ' 2026-10-04T12:00:00.000Z-0000-a1b2c3d4e5f60718'],
    ['nothing', ''],
  ])('refuses %s', (_title, text) => {
    expect(parseVersion(text)).toStrictEqual({
      ok: false,
      failure: { code: 'VERSION_MALFORMED', details: { path: '', issue: 'invalid_format' } },
    })
  })

  it.each([
    ['a day that does not exist', '2026-02-30T12:00:00.000Z-0000-a1b2c3d4e5f60718'],
    ['an hour that does not exist', '2026-10-04T25:00:00.000Z-0000-a1b2c3d4e5f60718'],
    ['a month that does not exist', '2026-13-04T12:00:00.000Z-0000-a1b2c3d4e5f60718'],
  ])('refuses %s', (_title, text) => {
    expect(parseVersion(text)).toStrictEqual({
      ok: false,
      failure: { code: 'VERSION_MALFORMED', details: { path: 'wallMs', issue: 'invalid_date' } },
    })
  })
})
