/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import { at } from './at'
import { DESCRIPTION_PLACEHOLDERS, randomPlaceholder } from './description-placeholder'

const pool: readonly string[] = DESCRIPTION_PLACEHOLDERS

const LAST = DESCRIPTION_PLACEHOLDERS.length - 1

describe('randomPlaceholder', () => {
  it('returns the first placeholder for rng 0', () => {
    expect(randomPlaceholder(0)).toBe(DESCRIPTION_PLACEHOLDERS[0])
  })

  it('returns the last placeholder for rng approaching 1', () => {
    expect(randomPlaceholder(0.999999)).toBe(at(DESCRIPTION_PLACEHOLDERS, LAST))
  })

  it('clamps rng === 1 to the last placeholder (never out of bounds)', () => {
    expect(randomPlaceholder(1)).toBe(at(DESCRIPTION_PLACEHOLDERS, LAST))
  })

  it('maps the mid range to a real placeholder', () => {
    const result = randomPlaceholder(0.5)
    expect(pool).toContain(result)
  })

  it('only ever returns a value from the pool', () => {
    for (let r = 0; r < 1; r += 0.01) {
      expect(pool).toContain(randomPlaceholder(r))
    }
  })
})
