// A spend's details as the sentence they read as: its parts, the values a chip changes, and what
// changing one sends. No DOM.

import type { InputOf, ListedTransaction, To } from '../shared/commands'
import { dayOf, todayIn } from './format'

/**
 * The parts of the sentence, in the order they read. From is shown but, until a later note, can't
 * be changed here.
 */
export type Part = 'amount' | 'description' | 'from' | 'date' | 'to'

/** The parts a chip changes. */
export type Changable = Exclude<Part, 'from'>

/** What a simple transaction holds: the values its chips start from and edit. */
export type Values = { description: string; amount: string; to: string | null; date: string }

/** The values a chip starts from; null for a transaction the card can't change here. */
export function savedValues(t: ListedTransaction): Values | null {
  return t.simple === null
    ? null
    : { description: t.description, amount: t.simple.amount, to: t.to, date: t.date }
}

/**
 * What saving `part` as `value` sends: amount and description as they are, and To or the day only
 * when they changed, so a spend left alone keeps them. A name both a category and an account have
 * mustn't move a spend that was left alone.
 */
export function changeOf(
  t: ListedTransaction,
  saved: Values,
  part: Changable,
  value: string,
  toOf: (typed: string) => To,
  today = todayIn(),
): InputOf<'spend.edit'> {
  const next = { ...saved, [part]: value }
  const date = dayOf(next.date, today)
  return {
    id: t.id,
    amount: next.amount,
    description: next.description,
    ...(next.to === null || next.to === t.to ? {} : { to: toOf(next.to) }),
    ...(date === t.date ? {} : { date }),
  }
}
