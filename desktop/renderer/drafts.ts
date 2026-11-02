// Unsaved changes to spends, kept in the window until they're saved or put back. Each change
// returns a new map, so Svelte sees it.

import type { ListedTransaction } from '../shared/commands'
import type { Field } from './refusals'

/** What the pane edits. */
export type Values = { description: string; amount: string }

/** One spend's unsaved values, and why its last save was refused, if it was. */
export type Draft = Values & { error: { field: Field; words: string } | null }

/** By transaction id. */
export type Drafts = ReadonlyMap<string, Draft>

/** The saved values the pane starts from, or null for a transaction it can't edit. */
export function savedValues(t: ListedTransaction): Values | null {
  return t.simple === null ? null : { description: t.description, amount: t.simple.amount }
}

/** After typing `value` into `field`. Typed back to what's saved, the draft goes. */
export function withEdit(
  drafts: Drafts,
  id: string,
  saved: Values,
  field: keyof Values,
  value: string,
): Drafts {
  const draft = { ...(drafts.get(id) ?? { ...saved, error: null }), [field]: value }
  if (sameValues(draft, saved)) return without(drafts, id)
  return new Map(drafts).set(id, draft)
}

/** After a save was refused: the draft stays, and says why. */
export function withError(drafts: Drafts, id: string, error: Draft['error']): Drafts {
  const draft = drafts.get(id)
  return draft === undefined ? drafts : new Map(drafts).set(id, { ...draft, error })
}

export function without(drafts: Drafts, id: string): Drafts {
  const next = new Map(drafts)
  next.delete(id)
  return next
}

/** After `sent` was saved: its draft goes, unless it was typed in while the save was on its way. */
export function afterSave(drafts: Drafts, id: string, sent: Values): Drafts {
  const draft = drafts.get(id)
  return draft !== undefined && sameValues(draft, sent) ? without(drafts, id) : drafts
}

const sameValues = (a: Values, b: Values) =>
  a.description === b.description && a.amount === b.amount
