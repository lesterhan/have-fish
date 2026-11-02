import { describe, expect, test } from 'vitest'
import { afterRemoving, kept, movedBy } from './selection'

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

describe('movedBy', () => {
  test.each([
    ['ArrowDown', 'b', 'c'],
    ['ArrowDown', 'c', 'c'],
    ['ArrowUp', 'b', 'a'],
    ['ArrowUp', 'a', 'a'],
    ['Home', 'c', 'a'],
    ['End', 'a', 'c'],
  ])('%s from %s goes to %s', (key, from, to) => {
    expect(movedBy(list, from, key)).toBe(to)
  })

  test('with nothing selected, the arrows start at the top', () => {
    expect(movedBy(list, null, 'ArrowDown')).toBe('a')
    expect(movedBy(list, null, 'ArrowUp')).toBe('a')
  })

  test('nowhere to go in an empty list', () => {
    expect(movedBy([], null, 'ArrowDown')).toBeNull()
  })

  test('any other key is not a move', () => {
    expect(movedBy(list, 'a', 'x')).toBeUndefined()
    expect(movedBy(list, 'a', 'Enter')).toBeUndefined()
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
