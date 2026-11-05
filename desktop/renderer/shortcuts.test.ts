import { describe, expect, test } from 'vitest'
import { ACTIONS } from '../shared/actions'
import { ariaShortcut, shortcutText } from './shortcuts'

describe('shortcutText', () => {
  test('Linux and Windows spell the modifiers out', () => {
    expect(shortcutText('saveAll', false)).toBe('Ctrl+S')
    expect(shortcutText('redo', false)).toBe('Ctrl+Shift+Z')
    expect(shortcutText('zoomIn', false)).toBe('Ctrl+=')
  })

  test('macOS uses its symbols, in its order, with nothing between', () => {
    expect(shortcutText('saveAll', true)).toBe('⌘S')
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
