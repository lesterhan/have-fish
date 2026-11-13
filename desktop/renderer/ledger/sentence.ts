// A spend's details as the sentence they read as: its parts, the values a chip changes, and what
// changing one sends. No DOM.

import type { InputOf, ListedLeg, ListedTransaction, Money, To } from '../../shared/commands'
import { dayOf, todayIn } from '../format'

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
 * What saving `part` as `value` sends, or null when it holds what's saved. Amount and description
 * go as they are, To and the day only when they changed, so a spend left alone keeps them: a name
 * both a category and an account have mustn't move a spend that was left alone.
 */
export function changeOf(
  t: ListedTransaction,
  saved: Values,
  part: Changable,
  value: string,
  toOf: (typed: string) => To,
  today = todayIn(),
): InputOf<'spend.edit'> | null {
  if (unchanged(t, saved, part, value, today)) return null
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

/** Whether `value` is what `part` holds already: To without its spaces, the day as it reads. */
function unchanged(
  t: ListedTransaction,
  saved: Values,
  part: Changable,
  value: string,
  today: string,
): boolean {
  if (part === 'to') return value.trim() === (t.to ?? '')
  if (part === 'date') return dayOf(value, today) === t.date
  return value === saved[part]
}

/** Each account a spend paid from more than one came out of, and how much, unsigned. */
export function paymentsOf(legs: readonly ListedLeg[]): { path: string; money: Money }[] {
  return legs.flatMap((leg) =>
    leg.path !== null && leg.amount.startsWith('-')
      ? [{ path: leg.path, money: { amount: leg.amount.slice(1), currency: leg.currency } }]
      : [],
  )
}

/** Where the money arrived, for a spend paid from more than one account. */
export const destinationOf = (legs: readonly ListedLeg[]): string | null =>
  legs.find((leg) => !leg.amount.startsWith('-') && leg.path !== null)?.path ?? null
