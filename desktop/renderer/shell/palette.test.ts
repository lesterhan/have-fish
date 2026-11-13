import { describe, expect, test } from 'vitest'
import { lettersIn, type PaletteItem, paletteItems, shownFor } from './palette'

const words = (items: readonly PaletteItem[]) => items.map((i) => `${i.heading}: ${i.label}`)

describe('the palette’s actions', () => {
  const items = paletteItems({ undo: 'Undo write Coffee', redo: null })

  test('every action the window carries out, under its heading, in the menu’s order', () => {
    expect(words(items)).toEqual([
      'actions: New spend',
      'actions: Add account',
      'actions: Undo write Coffee',
      'actions: Redo',
      'actions: Remove spend',
      'actions: Show or hide postings',
      'actions: Refile spend',
      'goTo: Ledger',
      'goTo: Accounts',
      'goTo: Reports',
      'settings: Compact',
      'settings: Regular',
      'settings: Comfortable',
      'settings: Large',
      'settings: Graphite light',
      'settings: Graphite dark',
      'settings: Follow the system',
    ])
  })

  test('not itself, and none Electron does: cut, copy, paste, zoom, quit', () => {
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain('palette')
    for (const id of ['cut', 'copy', 'paste', 'selectAll', 'zoomIn', 'quit']) {
      expect(ids).not.toContain(id)
    }
  })

  test('an action with a shortcut carries it; a choice made only from the menu has none', () => {
    expect(items.find((i) => i.id === 'newSpend')?.keyed).toBe(true)
    expect(items.find((i) => i.id === 'themeSystem')?.keyed).toBe(false)
  })
})

describe('the letters typed, in order', () => {
  test('anywhere in the words, case aside: where each one is', () => {
    expect(lettersIn('New spend', 'ns')).toEqual([0, 4])
    expect(lettersIn('Add account', 'ACC')).toEqual([0, 5, 6])
    expect(lettersIn('New spend', '')).toEqual([])
  })

  test('out of order, or not there: no match', () => {
    expect(lettersIn('New spend', 'dn')).toBeNull()
    expect(lettersIn('Ledger', 'x')).toBeNull()
  })

  test('spaces typed are skipped', () => {
    expect(lettersIn('New spend', 'n s')).toEqual([0, 4])
  })
})

describe('what shows for what was typed', () => {
  const items = paletteItems({ undo: null, redo: null })

  test('nothing typed: everything', () => {
    expect(shownFor(items, '')).toHaveLength(items.length)
  })

  test('the actions with those letters in order, each with them marked', () => {
    const shown = shownFor(items, 'acc')
    expect(shown.map((s) => s.item.label)).toEqual(['Add account', 'Accounts'])
    expect(shown[1]?.marked).toEqual([0, 1, 2])
  })

  test('none match: none', () => {
    expect(shownFor(items, 'zzz')).toEqual([])
  })
})
