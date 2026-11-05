import { describe, expect, test } from 'vitest'
import { afterRemoving, kept } from './selection'

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('kept', () => {
  test('the same spend while it is listed', () => {
    expect(kept(list, 'b')).toBe('b')
  })

  test('the newest when nothing is selected, or the selected one has gone', () => {
    expect(kept(list, null)).toBe('a')
    expect(kept(list, 'gone')).toBe('a')
  })

  test('nothing in an empty list', () => {
    expect(kept([], 'a')).toBeNull()
  })
})

describe('afterRemoving', () => {
  test('selects the row below the one removed', () => {
    expect(afterRemoving(list, 'b')).toBe('c')
  })

  test('or the one above, when it was the last', () => {
    expect(afterRemoving(list, 'c')).toBe('b')
  })

  test('or nothing, when it was the only one', () => {
    expect(afterRemoving([{ id: 'a' }], 'a')).toBeNull()
  })
})
