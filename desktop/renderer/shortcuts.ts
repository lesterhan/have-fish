// An action's shortcut, from the list, as a hint shows it and as `aria-keyshortcuts` says it.

import { copy } from '../copy'
import { ACTIONS, actionFor, type KeyedActionId, type WindowKeyId } from '../shared/actions'

/** Whether the window is on macOS, whose shortcuts use ⌘. */
export const MAC = typeof navigator !== 'undefined' && /^Mac/.test(navigator.platform)

type Modifier = 'ctrl' | 'alt' | 'shift' | 'cmd'

/** macOS order: ⌃⌥⇧⌘. Elsewhere Ctrl+Alt+Shift. */
const ORDER: Modifier[] = ['ctrl', 'alt', 'shift', 'cmd']
const SYMBOLS: Record<Modifier, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' }
const ARIA: Record<Modifier, string> = { ctrl: 'Control', alt: 'Alt', shift: 'Shift', cmd: 'Meta' }

/** Keys macOS shows as a symbol. */
const MAC_KEYS: Record<string, string> = { Delete: '⌦' }

/** `Ctrl+S` on Linux and Windows, `⌘S` on macOS. */
export function shortcutText(id: KeyedActionId, mac: boolean): string {
  const { modifiers, key } = keysOf(id, mac)
  if (mac) return [...modifiers.map((m) => SYMBOLS[m]), MAC_KEYS[key] ?? key].join('')
  return [...modifiers.map((m) => copy.actions.keys[m === 'cmd' ? 'ctrl' : m]), key].join('+')
}

/** `Control+S` on Linux and Windows, `Meta+S` on macOS. */
export function ariaShortcut(id: KeyedActionId, mac: boolean): string {
  const { modifiers, key } = keysOf(id, mac)
  return [...modifiers.map((m) => ARIA[m]), key].join('+')
}

/** The modifiers in display order, and the key, with `CmdOrCtrl` settled for this platform. */
function keysOf(id: KeyedActionId, mac: boolean): { modifiers: Modifier[]; key: string } {
  const parts = actionFor(id).accelerator.split(/\+(?!$)/)
  const last = parts.pop() ?? ''
  // A letter in capitals, as keyboards print it; a named key as it's spelled: `Delete`.
  const key = last.length === 1 ? last.toUpperCase() : last
  const modifiers = parts.map((p): Modifier => {
    const m = p.toLowerCase()
    if (m === 'cmdorctrl') return mac ? 'cmd' : 'ctrl'
    if (m === 'shift' || m === 'alt') return m
    throw new Error(`the list uses only CmdOrCtrl, Shift and Alt, not ${p}`)
  })
  return { modifiers: ORDER.filter((m) => modifiers.includes(m)), key }
}

const WINDOW_KEYS = ACTIONS.filter((a) => 'windowKey' in a)

/**
 * The action a plain key press is, where the window takes the key itself: Delete, P, R. None
 * with Ctrl, Cmd or Alt held. Whether it applies where the cursor is stays the caller's to say.
 */
export function windowKeyOf(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): WindowKeyId | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  return WINDOW_KEYS.find((a) => a.accelerator === key)?.id ?? null
}
