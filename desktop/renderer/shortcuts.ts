// An action's shortcut, from the list, as a hint shows it and as `aria-keyshortcuts` says it.

import { copy } from '../copy'
import { type ActionId, actionFor } from '../shared/actions'

/** Whether the window is on macOS, whose shortcuts use ⌘. */
export const MAC = typeof navigator !== 'undefined' && /^Mac/.test(navigator.platform)

type Modifier = 'ctrl' | 'alt' | 'shift' | 'cmd'

/** macOS order: ⌃⌥⇧⌘. Elsewhere Ctrl+Alt+Shift. */
const ORDER: Modifier[] = ['ctrl', 'alt', 'shift', 'cmd']
const SYMBOLS: Record<Modifier, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' }
const ARIA: Record<Modifier, string> = { ctrl: 'Control', alt: 'Alt', shift: 'Shift', cmd: 'Meta' }

/** `Ctrl+S` on Linux and Windows, `⌘S` on macOS. */
export function shortcutText(id: ActionId, mac: boolean): string {
  const { modifiers, key } = keysOf(id, mac)
  if (mac) return [...modifiers.map((m) => SYMBOLS[m]), key].join('')
  return [...modifiers.map((m) => copy.actions.keys[m === 'cmd' ? 'ctrl' : m]), key].join('+')
}

/** `Control+S` on Linux and Windows, `Meta+S` on macOS. */
export function ariaShortcut(id: ActionId, mac: boolean): string {
  const { modifiers, key } = keysOf(id, mac)
  return [...modifiers.map((m) => ARIA[m]), key].join('+')
}

/** The modifiers in display order, and the key, with `CmdOrCtrl` settled for this platform. */
function keysOf(id: ActionId, mac: boolean): { modifiers: Modifier[]; key: string } {
  const parts = actionFor(id).accelerator.split(/\+(?!$)/)
  const key = (parts.pop() ?? '').toUpperCase()
  const modifiers = parts.map((p): Modifier => {
    const m = p.toLowerCase()
    if (m === 'cmdorctrl') return mac ? 'cmd' : 'ctrl'
    if (m === 'shift' || m === 'alt') return m
    throw new Error(`the list uses only CmdOrCtrl, Shift and Alt, not ${p}`)
  })
  return { modifiers: ORDER.filter((m) => modifiers.includes(m)), key }
}
