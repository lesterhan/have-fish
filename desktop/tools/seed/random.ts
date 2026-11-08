// Seeded randomness. Each day and purpose gets its own stream, so adding a spend to one day
// moves nothing on any other, and a later top-up draws exactly what a full seed would have.

import { createHash } from 'node:crypto'

export type Rng = {
  /** A float in [0, 1). */
  next(): number
  /** A whole number in [min, max], both included. */
  int(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  /** Cents between two amounts in dollars, both included. */
  cents(min: number, max: number): number
}

/** mulberry32: small, fast, and the same on every machine. */
export function rngFrom(text: string): Rng {
  let s = hash32(text)
  const next = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick(items) {
      const item = items[Math.floor(next() * items.length)]
      if (item === undefined) throw new Error('pick from an empty list')
      return item
    },
    cents: (min, max) => int(Math.round(min * 100), Math.round(max * 100)),
  }
}

/** A stable number for `text`, for choices that hang off an id rather than a stream. */
export function hash32(text: string): number {
  return createHash('sha256').update(text).digest().readUInt32BE(0)
}

/** A version-4-shaped UUID that `text` always gives. */
export function uuidFrom(text: string): string {
  const b = createHash('sha256').update(text).digest()
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = b.subarray(0, 16).toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
