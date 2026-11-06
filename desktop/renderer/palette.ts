// Ctrl+K's palette: every action the window carries out, from the one list that feeds the menu,
// under its heading, found by the letters typed in order (see #616).

import { copy } from '../copy'
import { ACTIONS, type Action, type WindowActionId } from '../shared/actions'

export type Heading = 'actions' | 'goTo' | 'settings'

export type PaletteItem = {
  id: WindowActionId
  label: string
  heading: Heading
  /** Whether it has a shortcut, for its keycap. */
  keyed: boolean
}

/** An item and where the letters typed are in its words. */
export type Shown = { item: PaletteItem; marked: number[] }

const HEADINGS: Heading[] = ['actions', 'goTo', 'settings']

const headingOf = (action: Action): Heading =>
  action.theme !== undefined ? 'settings' : action.id.startsWith('show') ? 'goTo' : 'actions'

/**
 * Every action but Electron's own (cut, paste, zoom, quit) and the palette itself, under its
 * heading. Undo and Redo say the step they'd take, as the menu does, when there is one.
 */
export function paletteItems(steps: { undo: string | null; redo: string | null }): PaletteItem[] {
  const listed: readonly Action[] = ACTIONS
  const items = listed
    .filter((a) => a.role === undefined && a.id !== 'palette')
    .map((a) => {
      const id = a.id as WindowActionId
      const named = id === 'undo' || id === 'redo' ? steps[id] : null
      return {
        id,
        label: named ?? copy.actions.labels[id],
        heading: headingOf(a),
        keyed: a.accelerator !== undefined,
      }
    })
  return HEADINGS.flatMap((h) => items.filter((i) => i.heading === h))
}

/** Where each letter of `typed` is in `words`, in order and case aside; null when they aren't. */
export function lettersIn(words: string, typed: string): number[] | null {
  const lower = words.toLowerCase()
  const marked: number[] = []
  let from = 0
  for (const letter of typed.toLowerCase().replace(/\s+/g, '')) {
    const at = lower.indexOf(letter, from)
    if (at === -1) return null
    marked.push(at)
    from = at + 1
  }
  return marked
}

/** The items with `typed`'s letters in order, in the list's order. */
export function shownFor(items: readonly PaletteItem[], typed: string): Shown[] {
  return items.flatMap((item) => {
    const marked = lettersIn(item.label, typed)
    return marked === null ? [] : [{ item, marked }]
  })
}
