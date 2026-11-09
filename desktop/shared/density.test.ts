import { describe, expect, test } from 'vitest'
import { DENSITIES, densityOf } from './density'

describe('densityOf', () => {
  test('a density this version knows is itself', () => {
    expect(densityOf('large')).toBe('large')
  })

  test('one it does not know is Regular', () => {
    expect(densityOf('huge')).toBe('regular')
  })

  test('nothing saved is Regular', () => {
    expect(densityOf(undefined)).toBe('regular')
  })

  test('the four, in their order, Regular second', () => {
    expect(DENSITIES).toEqual(['compact', 'regular', 'comfortable', 'large'])
  })
})
