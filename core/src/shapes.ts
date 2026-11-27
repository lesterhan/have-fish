// The shapes a transaction takes: what the app writes, edits and lists. Decided here and nowhere
// else, from the postings and their accounts' kinds.

import { type AccountKind, isAddable } from './account-kind'
import { type Leg, simpleAmountOf } from './postings'

/** One posting: its account, and its amount in cents. */
export type ShapeLeg = { accountId: string; cents: number; currency: string }

/**
 * A spend, a transfer or income goes `from` the negative leg `to` the positive one. A start is an
 * account's opening balance; given what it cost in another currency, it goes through the
 * conversion account `via`, and `opening` is the cost. A converted spend pays a category in
 * another currency, an exchange moves money between accounts of mine into another, each through
 * the conversion account `via`. An awaiting spend is a converted one whose charge isn't known
 * yet: `from` is its zero leg. Anything else is `other`, with its one amount when it has one.
 */
export type Shape =
  | { shape: 'spend' | 'transfer' | 'income'; from: ShapeLeg; to: ShapeLeg }
  | { shape: 'converted' | 'exchange'; from: ShapeLeg; to: ShapeLeg; via: string }
  | { shape: 'awaiting'; from: ShapeLeg; to: ShapeLeg; via: string }
  | { shape: 'start'; account: ShapeLeg; opening: ShapeLeg; via?: string }
  | { shape: 'other'; amount: Leg | null }

export type ShapeName = Shape['shape']

/** What a transaction is, from its postings and the kind of each one's account. */
export function shapeOf(
  legs: readonly ShapeLeg[],
  kindOf: (accountId: string) => AccountKind | undefined,
): Shape {
  const converted = convertedOf(legs, kindOf)
  if (converted !== null) return converted
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

/**
 * Four legs: an account of mine paying in one currency, a category or an account of mine getting
 * another, and the conversion account taking each, in any order; or the opening account at one
 * end and an account of mine at the other: a start with its cost. Its charge at zero, it is
 * awaiting. Null for anything else.
 */
function convertedOf(
  legs: readonly ShapeLeg[],
  kindOf: (accountId: string) => AccountKind | undefined,
): Shape | null {
  if (legs.length !== 4) return null
  const through = legs.filter((l) => kindOf(l.accountId) === 'conversion')
  const [one, two] = through
  if (through.length !== 2 || one === undefined || two === undefined) return null
  if (one.accountId !== two.accountId) return null
  const ends = legs.filter((l) => !through.includes(l))
  const from = ends.find((l) => l.cents < 0) ?? ends.find((l) => l.cents === 0)
  const to = ends.find((l) => l.cents > 0)
  if (from === undefined || to === undefined || from.currency === to.currency) return null
  const takes = (end: ShapeLeg) =>
    through.some((l) => l.currency === end.currency && l.cents === -end.cents)
  if (!takes(from) || !takes(to)) return null
  const [out, into, via] = [kindOf(from.accountId), kindOf(to.accountId), one.accountId]
  // A charge the bank hasn't posted yet waits at zero.
  if (from.cents === 0)
    return out !== undefined && isAddable(out) && into === 'category'
      ? { shape: 'awaiting', from, to, via }
      : null
  if (out === 'opening' && into !== undefined && isAddable(into))
    return { shape: 'start', account: to, opening: from, via }
  if (into === 'opening' && out !== undefined && isAddable(out))
    return { shape: 'start', account: from, opening: to, via }
  if (out === undefined || !isAddable(out)) return null
  if (into === 'category') return { shape: 'converted', from, to, via }
  if (into !== undefined && isAddable(into)) return { shape: 'exchange', from, to, via }
  return null
}

/** The postings a shape the app writes is made of: `to` first, as a spend is written. */
export function legsOf(
  ends:
    | { from: ShapeLeg; to: ShapeLeg; via?: string }
    | { account: ShapeLeg; opening: ShapeLeg; via?: string },
): ShapeLeg[] {
  if ('account' in ends) {
    if (ends.via === undefined) return [ends.account, ends.opening]
    return [
      ends.account,
      { accountId: ends.via, cents: -ends.account.cents, currency: ends.account.currency },
      { accountId: ends.via, cents: -ends.opening.cents, currency: ends.opening.currency },
      ends.opening,
    ]
  }
  const { from, to, via } = ends
  if (via === undefined) return [to, from]
  return [
    to,
    { accountId: via, cents: -to.cents, currency: to.currency },
    { accountId: via, cents: -from.cents, currency: from.currency },
    from,
  ]
}

/** The one amount a transaction moves, positive; null when it has none. */
export function amountOf(shape: Shape): Leg | null {
  switch (shape.shape) {
    case 'other':
      return shape.amount
    case 'start':
      return { cents: Math.abs(shape.account.cents), currency: shape.account.currency }
    default:
      return { cents: shape.to.cents, currency: shape.to.currency }
  }
}
