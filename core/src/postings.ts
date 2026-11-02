import { isValidCurrency } from './currencies'
import { parse } from './money'
import type { Outcome } from './outcome'
import { failure } from './outcome'

export type PostingDraft = { accountId: string; amount: string; currency: string }

// `validatePostings` decides whether a set of postings may stand as one transaction:
//
// 1. at least two postings, because a single leg moves money from nowhere;
// 2. every currency is one this ledger supports;
// 3. every amount is one `parse` accepts;
// 4. within each currency, the amounts sum to exactly zero, in cents. Currencies are never
//    netted against each other; a conversion balances because it carries a leg in each
//    currency.
//
// The checks run in that order and the first failure is the answer. Pure, so a device runs
// the same rule on a document it received.

export function validatePostings(postings: readonly PostingDraft[]): Outcome<void> {
  if (postings.length < 2) {
    return failure('TOO_FEW_POSTINGS')
  }

  for (const posting of postings) {
    if (!isValidCurrency(posting.currency)) {
      return failure('UNSUPPORTED_CURRENCY', { currency: posting.currency })
    }
  }

  const currencyBalances = new Map<string, number>()
  for (const posting of postings) {
    const amount = parse(posting.amount)
    if (amount === null) {
      return failure('AMOUNT_INVALID', { amount: posting.amount })
    }

    // check all currencies sum to zero
    const balance = currencyBalances.get(posting.currency) ?? 0
    currencyBalances.set(posting.currency, amount + balance)
  }

  for (const [currency, balance] of currencyBalances) {
    if (balance !== 0) {
      return failure('POSTINGS_DO_NOT_BALANCE', { currency, cents: balance })
    }
  }

  return { ok: true, value: undefined }
}

/** A posting's amount in cents, and its currency. */
export type Leg = { cents: number; currency: string }

/**
 * The one amount a transaction moves, when it is two postings in one currency that balance:
 * the positive one's. Null for anything else, such as a split or a conversion, where setting
 * "the amount" would have to guess which posting gets it.
 */
export function simpleAmountOf(legs: readonly Leg[]): Leg | null {
  const [a, b] = legs
  if (legs.length !== 2 || a === undefined || b === undefined) return null
  if (a.currency !== b.currency || a.cents + b.cents !== 0) return null
  const cents = Math.max(a.cents, b.cents)
  return cents > 0 ? { cents, currency: a.currency } : null
}
