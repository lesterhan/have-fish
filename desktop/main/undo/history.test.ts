import { describe, expect, test } from 'vitest'
import { History } from './history'

describe('History', () => {
  test('starts with nothing to undo or redo', () => {
    const h = new History<string>()
    expect([h.nextUndo(), h.nextRedo()]).toEqual([undefined, undefined])
  })

  test('undoes newest first', () => {
    const h = new History<string>()
    h.record('a')
    h.record('b')
    expect(h.nextUndo()).toBe('b')
    h.undid()
    expect(h.nextUndo()).toBe('a')
  })

  test('redoes what was undone, the last undone first', () => {
    const h = new History<string>()
    h.record('a')
    h.record('b')
    h.undid()
    h.undid()
    expect(h.nextRedo()).toBe('a')
    h.redid()
    expect([h.nextUndo(), h.nextRedo()]).toEqual(['a', 'b'])
  })

  test('a new change empties redo', () => {
    const h = new History<string>()
    h.record('a')
    h.undid()
    h.record('b')
    expect(h.nextRedo()).toBeUndefined()
    expect(h.nextUndo()).toBe('b')
  })

  test('a step that can never be undone leaves, and the one before it is next', () => {
    const h = new History<string>()
    h.record('a')
    h.record('b')
    h.dropUndo()
    expect(h.nextUndo()).toBe('a')
  })

  test('a step that can never be redone leaves, and the one after it is next', () => {
    const h = new History<string>()
    h.record('a')
    h.record('b')
    h.undid()
    h.undid()
    h.dropRedo()
    expect(h.nextRedo()).toBe('b')
  })

  test('map changes every step, done and undone, and keeps their order', () => {
    const h = new History<string>()
    h.record('a')
    h.record('b')
    h.undid()
    h.map((s) => s.toUpperCase())
    expect([h.nextUndo(), h.nextRedo()]).toEqual(['A', 'B'])
  })
})
