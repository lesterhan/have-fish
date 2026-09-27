// How a Fish Pie expense divides between members. Pure: `fish-pie-expense-service.ts` and
// the expense routes load the members and weights, and write what this returns.
//
// Floats rounded to the cent at each step, as the code this came out of did; #451 moves
// Fish Pie to integer cents.

/** A member as a split sees them. */
export type Weighted = { userId: string; shareWeight: number }

/**
 * Divide `amount` by weight, each share rounded to the cent. The cents rounding leaves over
 * go to the payer's share, so the shares always add up to the amount.
 * Throws on no members or a zero total weight: callers check both first.
 */
export function computeSplits(
  amount: string,
  members: readonly Weighted[],
  payerId: string,
): { userId: string; amount: string }[] {
  if (members.length === 0) throw new Error('cannot split among zero members')
  const total = parseFloat(amount)
  const totalWeight = members.reduce((s, m) => s + m.shareWeight, 0)
  if (totalWeight === 0) throw new Error('total member share weight is zero')

  let remaining = total
  const splits = members.map((m) => {
    const share = Math.round(((total * m.shareWeight) / totalWeight) * 100) / 100
    remaining = Math.round((remaining - share) * 100) / 100
    return { userId: m.userId, amount: share.toFixed(2) }
  })

  if (remaining !== 0) {
    const payerSplit = splits.find((s) => s.userId === payerId)
    if (payerSplit) payerSplit.amount = (parseFloat(payerSplit.amount) + remaining).toFixed(2)
  }

  return splits
}

/**
 * A category's weights, if they apply to these members: only when every one of them has
 * one. A partial set would silently reshape the split, so the group weights stand instead.
 */
export function categoryWeightsFor(
  members: readonly { userId: string }[],
  weights: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> | null {
  const allHaveWeight = members.length > 0 && members.every((m) => weights.has(m.userId))
  return allHaveWeight ? weights : null
}

/**
 * The members with the given weights in place of their own. With none, the members as they
 * are. From `categoryWeightsFor` over the same members, every member has a weight, so the
 * fallback to their own never applies.
 */
export function withWeights<T extends Weighted>(
  members: readonly T[],
  weights: ReadonlyMap<string, number> | null,
): T[] {
  if (!weights) return [...members]
  return members.map((m) => ({ ...m, shareWeight: weights.get(m.userId) ?? m.shareWeight }))
}

/**
 * Weights for an edited expense: an explicit per-expense weight wins for the members it
 * names; everyone else keeps the weight they had.
 */
export function withExplicitWeights<T extends Weighted>(
  members: readonly T[],
  explicit: readonly Weighted[],
): T[] {
  return members.map((m) => ({
    ...m,
    shareWeight: explicit.find((s) => s.userId === m.userId)?.shareWeight ?? m.shareWeight,
  }))
}

/**
 * The payer's fraction of the expense: their weight over the total. A payer missing from
 * the list counts as weight 1; a zero total weight gives 0.
 */
export function payerShareRatio(members: readonly Weighted[], payerId: string): number {
  const totalWeight = members.reduce((s, m) => s + m.shareWeight, 0)
  const payerWeight = members.find((m) => m.userId === payerId)?.shareWeight ?? 1
  return totalWeight === 0 ? 0 : payerWeight / totalWeight
}

/**
 * An import-linked expense's net amount divided into the payer's share and everyone else's,
 * as the two legs of the import transaction hold them. The payer's share is rounded to the
 * cent and the rest is what's left, so the two add up to the net.
 */
export function splitNet(net: number, ratio: number): { payerShare: string; othersShare: string } {
  const payerShare = (net * ratio).toFixed(2)
  return { payerShare, othersShare: (net - parseFloat(payerShare)).toFixed(2) }
}
