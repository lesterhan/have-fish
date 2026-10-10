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
    if (parse(posting.amount) === null) {
      return failure('AMOUNT_INVALID', { amount: posting.amount })
    }
  }
  return { ok: true, value: undefined }
}
