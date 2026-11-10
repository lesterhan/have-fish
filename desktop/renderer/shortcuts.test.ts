import { describe, expect, test } from 'vitest'
import { ACTIONS } from '../shared/actions'
import { ariaShortcut, shortcutText, windowKeyOf } from './shortcuts'

describe('shortcutText', () => {
  test('Linux and Windows spell the modifiers out', () => {
    expect(shortcutText('newSpend', false)).toBe('Ctrl+N')
    expect(shortcutText('redo', false)).toBe('Ctrl+Shift+Z')
    expect(shortcutText('zoomIn', false)).toBe('Ctrl+=')
  })

  test('macOS uses its symbols, in its order, with nothing between', () => {
    expect(shortcutText('newSpend', true)).toBe('⌘N')
    expect(shortcutText('redo', true)).toBe('⇧⌘Z')
    expect(shortcutText('zoomOut', true)).toBe('⌘-')
  })
})

describe('ariaShortcut', () => {
  test("in aria-keyshortcuts' own form", () => {
    expect(ariaShortcut('newSpend', false)).toBe('Control+N')
    expect(ariaShortcut('newSpend', true)).toBe('Meta+N')
    expect(ariaShortcut('redo', false)).toBe('Control+Shift+Z')
  })
})

test('every action in the list can be shown, on both', () => {
  for (const action of ACTIONS) {
    if (!('accelerator' in action) || !action.accelerator.startsWith('CmdOrCtrl')) continue
    const { id } = action
    expect(shortcutText(id, false)).toMatch(/^Ctrl\+/)
    expect(shortcutText(id, true)).toMatch(/⌘/)
  }
})

test('a named key with no modifier is spelled out, or its symbol on macOS', () => {
  expect(shortcutText('remove', false)).toBe('Delete')
  expect(shortcutText('remove', true)).toBe('⌦')
  expect(ariaShortcut('remove', false)).toBe('Delete')
})

test('a letter key with no modifier is its capital, on both', () => {
  expect(shortcutText('refile', false)).toBe('R')
  expect(shortcutText('postings', true)).toBe('P')
})

describe('windowKeyOf', () => {
  const press = (key: string, held: Partial<KeyboardEvent> = {}) =>
    windowKeyOf({ key, ctrlKey: false, metaKey: false, altKey: false, ...held })

  test('a plain press of a key the window takes is its action, either case', () => {
    expect(press('Delete')).toBe('remove')
    expect(press('p')).toBe('postings')
    expect(press('R')).toBe('refile')
  })

  test('with Ctrl, Cmd or Alt held, or another key, it is none', () => {
    expect(press('r', { ctrlKey: true })).toBeNull()
    expect(press('p', { metaKey: true })).toBeNull()
    expect(press('Delete', { altKey: true })).toBeNull()
    expect(press('n')).toBeNull()
    expect(press('Enter')).toBeNull()
  })
})
