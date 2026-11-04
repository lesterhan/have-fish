// Unsaved changes to spends, kept in the window until they're saved or put back. Each change
// returns a new map, so Svelte sees it.

import type { InputOf, ListedTransaction, To } from '../shared/commands'
import type { Field } from './refusals'

/**
 * What the pane edits. `to`, where the money went, as typed, is null for a transaction that can't
 * be sent elsewhere, like a starting balance. `date` is the field's `YYYY-MM-DD`.
 */
export type Values = { description: string; amount: string; to: string | null; date: string }

/** One spend's unsaved values, and why its last save was refused, if it was. */
export type Draft = Values & { error: { field: Field; words: string } | null }

/** By transaction id. */
export type Drafts = ReadonlyMap<string, Draft>

/** The saved values the pane starts from, or null for a transaction it can't edit. */
export function savedValues(t: ListedTransaction): Values | null {
  return t.simple === null
    ? null
    : { description: t.description, amount: t.simple.amount, to: t.to, date: t.date }
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

/** One draft on its way to be saved. */
export type Sending = { id: string; sent: Values }

/** The drafts of `ids` that have one, as they are now. */
export function toSend(drafts: Drafts, ids: Iterable<string>): Sending[] {
  return [...ids].flatMap((id) => {
    const draft = drafts.get(id)
    if (draft === undefined) return []
    const { description, amount, to, date } = draft
    return [{ id, sent: { description, amount, to, date } }]
  })
}

/**
 * A draft as `spend.edit` takes it: where the money goes only when it changed from `saved`, so a
 * name both a category and an account have never moves a spend that was left alone; its day only
 * when it changed from `savedDate`.
 */
export function editOf(
  { id, sent }: Sending,
  saved: string | null | undefined,
  toOf: (typed: string) => To,
  savedDate: string | undefined,
): InputOf<'spend.edit'> {
  const { description, amount, to, date } = sent
  return {
    id,
    description,
    amount,
    ...(to === null || to === saved ? {} : { to: toOf(to) }),
    ...(date === savedDate ? {} : { date }),
  }
}

/** After several saves came back, each one saved (`error: null`) or refused. */
export function afterSaves(
  drafts: Drafts,
  saves: readonly (Sending & { error: Draft['error'] })[],
): Drafts {
  return saves.reduce(
    (next, { id, sent, error }) =>
      error === null ? afterSave(next, id, sent) : withError(next, id, error),
    drafts,
  )
}

const sameValues = (a: Values, b: Values) =>
  a.description === b.description && a.amount === b.amount && a.to === b.to && a.date === b.date
