// A spend card's chips being changed, without a DOM: which one is open, what its editor holds,
// why its last save was refused, and which one just saved. `SpendCard.svelte` holds one of these
// and draws it; what a change sends is `changeOf`'s.

import type { InputOf, ListedTransaction, To } from '../../shared/commands'
import { todayIn } from '../format'
import { type Changable, changeOf, savedValues } from './sentence'

export type Editing = {
  /** The chip being changed, if one is. */
  part: Changable | null
  /** What its editor holds. */
  value: string
  /** Why its last save was refused. */
  error: string | null
  /** A save is on its way: Enter again sends nothing. */
  saving: boolean
  /** The chip just saved, while its flash and tick show. */
  justSaved: Changable | null
}

export const closed: Editing = {
  part: null,
  value: '',
  error: null,
  saving: false,
  justSaved: null,
}

/** Clicking a chip, or Enter on it: its editor, holding what's saved. */
export function opened(editing: Editing, t: ListedTransaction, part: Changable): Editing {
  const values = savedValues(t)
  if (values === null) return editing
  return { ...editing, part, value: values[part] ?? '', error: null }
}

/** Enter: what to send, or that it's what's saved; null with no chip open or a save going. */
export function committing(
  editing: Editing,
  t: ListedTransaction,
  toOf: (typed: string) => To,
  today = todayIn(),
): { unchanged: Changable } | { send: InputOf<'spend.edit'> } | null {
  const values = savedValues(t)
  if (editing.part === null || values === null || editing.saving) return null
  const send = changeOf(t, values, editing.part, editing.value, toOf, today)
  return send === null ? { unchanged: editing.part } : { send }
}

export const sending = (editing: Editing): Editing => ({ ...editing, saving: true })

/** Saved: the chip closes and flashes. */
export const saved = (editing: Editing): Editing => ({ ...closed, justSaved: editing.part })

/** Refused: the chip stays open, holding what was typed, and says why. */
export const refused = (editing: Editing, words: string): Editing => ({
  ...editing,
  saving: false,
  error: words,
})

/** Esc on an open chip: what was typed goes and the chip closes. */
export const putBack = (editing: Editing): Editing => ({ ...closed, justSaved: editing.justSaved })

/** A chip's flash has ended: its tick goes too. */
export const flashed = (editing: Editing, part: Changable): Editing =>
  editing.justSaved === part ? { ...editing, justSaved: null } : editing
