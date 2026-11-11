// The shapes a transaction takes: what the app writes, edits and lists. Decided here and nowhere
// else, from the postings and their accounts' kinds.

import { type AccountKind, isAddable } from './account-kind'
import { type Leg, simpleAmountOf } from './postings'

/** One posting: its account, and its amount in cents. */
export type ShapeLeg = { accountId: string; cents: number; currency: string }

/**
 * A spend, a transfer or income goes `from` the negative leg `to` the positive one. A start is an
 * account's opening balance. Anything else is `other`, with its one amount when it has one.
 */
export type Shape =
  | { shape: 'spend' | 'transfer' | 'income'; from: ShapeLeg; to: ShapeLeg }
  | { shape: 'start'; account: ShapeLeg; opening: ShapeLeg }
  | { shape: 'other'; amount: Leg | null }

export type ShapeName = Shape['shape']

/** What a transaction is, from its postings and the kind of each one's account. */
export function shapeOf(
  legs: readonly ShapeLeg[],
  kindOf: (accountId: string) => AccountKind | undefined,
): Shape {
  const amount = simpleAmountOf(legs)
  const from = legs.find((l) => l.cents < 0)
  const to = legs.find((l) => l.cents > 0)
  const other = { shape: 'other', amount } as const
  if (amount === null || from === undefined || to === undefined) return other
  const [out, into] = [kindOf(from.accountId), kindOf(to.accountId)]
  if (out === undefined || into === undefined) return other

  if (isAddable(out) && into === 'category') return { shape: 'spend', from, to }
  if (isAddable(out) && isAddable(into)) return { shape: 'transfer', from, to }
  if (out === 'income' && isAddable(into)) return { shape: 'income', from, to }
  if (out === 'opening' && isAddable(into)) return { shape: 'start', account: to, opening: from }
  if (isAddable(out) && into === 'opening') return { shape: 'start', account: from, opening: to }
  return other
}

/** The postings a shape the app writes is made of: `to` first, as a spend is written. */
export function legsOf(
  ends: { from: ShapeLeg; to: ShapeLeg } | { account: ShapeLeg; opening: ShapeLeg },
): ShapeLeg[] {
  return 'account' in ends ? [ends.account, ends.opening] : [ends.to, ends.from]
}

/** The one amount a transaction moves, positive; null when it has none. */
export function amountOf(shape: Shape): Leg | null {
  switch (shape.shape) {
    case 'other':
      return shape.amount
    case 'start': {
      const { cents, currency } = shape.account.cents > 0 ? shape.account : shape.opening
      return { cents, currency }
    }
    default:
      return { cents: shape.to.cents, currency: shape.to.currency }
  }
}
