import { parse } from '../../ledger-money'

// Whether a transaction's legs balance, by the server's rule (`ledger/validate.ts`): each
// currency sums to exactly zero in cents, every amount rounded to the cent as the column
// stores it. Both editors check this before they let a save through (#450).

/**
 * Each currency's sum in cents. An amount that can't be read yet (blank, a lone `-` while
 * the user is typing) is left out rather than counted as zero or refused here.
 */
export function balancesInCents(
  postings: readonly { amount: string; currency: string }[],
): Map<string, number> {
  const sums = new Map<string, number>()
  for (const p of postings) {
    const cents = parse(p.amount)
    if (cents !== null) sums.set(p.currency, (sums.get(p.currency) ?? 0) + cents)
  }
  return sums
}

/** True when every currency sums to exactly zero. */
export function isBalanced(balances: ReadonlyMap<string, number>): boolean {
  return [...balances.values()].every((cents) => cents === 0)
}
