import { describe, expect, test } from 'vitest'
import { tabAfter } from './tabs'

describe('tabAfter', () => {
  test('the arrow right moves one tab on', () => {
    expect(tabAfter('ArrowRight', 0, 3)).toBe(1)
  })

  test('the arrow right on the last wraps to the first', () => {
    expect(tabAfter('ArrowRight', 2, 3)).toBe(0)
  })

  test('the arrow left moves one tab back', () => {
    expect(tabAfter('ArrowLeft', 2, 3)).toBe(1)
  })

  test('the arrow left on the first wraps to the last', () => {
    expect(tabAfter('ArrowLeft', 0, 3)).toBe(2)
  })

  test('Home goes to the first tab', () => {
    expect(tabAfter('Home', 2, 4)).toBe(0)
  })

  test('End goes to the last tab', () => {
    expect(tabAfter('End', 0, 4)).toBe(3)
  })

  test('a lone tab stays where the arrow right finds it', () => {
    expect(tabAfter('ArrowRight', 0, 1)).toBe(0)
  })

  test('an empty strip has nowhere to go', () => {
    expect(tabAfter('ArrowRight', 0, 0)).toBeNull()
  })

  test('the vertical arrow moves nothing', () => {
    expect(tabAfter('ArrowDown', 0, 3)).toBeNull()
  })

  test('a key the pattern does not name moves nothing', () => {
    expect(tabAfter('Enter', 0, 3)).toBeNull()
  })
})
