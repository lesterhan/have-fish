import { describe, expect, test } from 'vitest'
import { FieldUndo, wayOf } from './undo'

const keys = (key: string, mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>>) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
})

describe('wayOf', () => {
  test('Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, off macOS', () => {
    expect(wayOf(keys('z', { ctrl: true }), false)).toBe('undo')
    expect(wayOf(keys('Z', { ctrl: true, shift: true }), false)).toBe('redo')
    expect(wayOf(keys('y', { ctrl: true }), false)).toBe('redo')
  })

  test('⌘Z and ⇧⌘Z on macOS, where Ctrl+Y is nothing', () => {
    expect(wayOf(keys('z', { meta: true }), true)).toBe('undo')
    expect(wayOf(keys('Z', { meta: true, shift: true }), true)).toBe('redo')
    expect(wayOf(keys('y', { ctrl: true }), true)).toBeNull()
    expect(wayOf(keys('z', { ctrl: true }), true)).toBeNull()
  })

  test('anything else is neither', () => {
    expect(wayOf(keys('z', {}), false)).toBeNull()
    expect(wayOf(keys('z', { ctrl: true, alt: true }), false)).toBeNull()
    expect(wayOf(keys('s', { ctrl: true }), false)).toBeNull()
  })
})

describe('FieldUndo', () => {
  /** A field holding `value`, typed into the way the window sees it. */
  const field = (value = '') => ({ value })
  const type = (u: FieldUndo, f: { value: string }, to: string, inputType = 'insertText') => {
    u.changing(f)
    f.value = to
    u.changed(f, inputType)
  }

  test('a field you only entered has no typing, so both go to the ledger', () => {
    const u = new FieldUndo()
    const f = field('Coffee')
    u.entered(f)
    expect(u.typing(f)).toEqual({ undo: false, redo: false })
  })

  test('typing goes to the field, until it is undone back to where you started', () => {
    const u = new FieldUndo()
    const f = field()
    u.entered(f)
    type(u, f, '12')
    expect(u.typing(f).undo).toBe(true)
    type(u, f, '', 'historyUndo')
    expect(u.typing(f)).toEqual({ undo: false, redo: true })
  })

  test('redo goes to the field only while it has undos to put back', () => {
    const u = new FieldUndo()
    const f = field()
    u.entered(f)
    type(u, f, '12')
    type(u, f, '', 'historyUndo')
    type(u, f, '12', 'historyRedo')
    expect(u.typing(f)).toEqual({ undo: true, redo: false })
    type(u, f, '', 'historyUndo')
    type(u, f, '3')
    expect(u.typing(f).redo).toBe(false)
  })

  test('entering the field again starts over', () => {
    const u = new FieldUndo()
    const f = field()
    u.entered(f)
    type(u, f, '7')
    u.entered(f)
    expect(u.typing(f).undo).toBe(false)
  })

  test('text the app sets itself is not your typing', () => {
    const u = new FieldUndo()
    const f = field('Coffee')
    u.entered(f)
    type(u, f, 'Coffee cake')
    f.value = 'Coffee'
    expect(u.typing(f)).toEqual({ undo: false, redo: false })
  })

  test('typing after the app set the text starts from what it set', () => {
    const u = new FieldUndo()
    const f = field('Coffee')
    u.entered(f)
    type(u, f, 'Coffee cake')
    f.value = 'Coffee'
    type(u, f, 'Coffee!')
    type(u, f, 'Coffee', 'historyUndo')
    expect(u.typing(f).undo).toBe(false)
  })

  test('after a save, the typing belongs to the ledger', () => {
    const u = new FieldUndo()
    const f = field()
    u.entered(f)
    type(u, f, 'Tea')
    u.forget()
    expect(u.typing(f)).toEqual({ undo: false, redo: false })
  })

  test('nothing focused is the ledger', () => {
    expect(new FieldUndo().typing(null)).toEqual({ undo: false, redo: false })
  })
})
