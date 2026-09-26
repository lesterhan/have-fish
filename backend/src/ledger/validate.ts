import { isValidCurrency } from '../currencies'
import { errorBody, type Outcome } from '../errors'

/** One leg of a transaction as a caller proposes it, before anything is written. */
export type PostingDraft = { accountId: string; amount: string; currency: string }

/**
 * Whether a set of postings may be written as one transaction:
 *
 * 1. at least two postings, because a single leg moves money from nowhere;
 * 2. every currency is one this ledger supports;
 * 3. within each currency, the amounts sum to zero. Currencies are never netted against
 *    each other; a conversion balances because it carries a leg in each currency.
 *
 * The checks run in that order and the first failure is the answer. Pure: no database,
 * no request. That's what lets a device run the same rule on a document it received.
 *
 * `index` is the transaction's position in a batch. When present it is carried into every
 * failure so the client can say which entry is wrong. A batch has never reported `sum` for
 * an unbalanced entry and a single transaction always has; both are kept as they were.
 *
 * The arithmetic is `parseFloat` with a 0.001 tolerance, as it always was. #279 replaces it
 * with integer cents, here and only here.
 */
export function validatePostings(postings: readonly PostingDraft[], index?: number): Outcome<void> {
  const at = index === undefined ? {} : { index }

  if (postings.length < 2) {
    const failure =
      index === undefined ? errorBody('TOO_FEW_POSTINGS') : errorBody('TOO_FEW_POSTINGS', { index })
    return { ok: false, failure }
  }

  for (const p of postings) {
    if (!isValidCurrency(p.currency)) {
      return {
        ok: false,
        failure: errorBody('UNSUPPORTED_CURRENCY', { currency: p.currency, ...at }),
      }
    }
  }

  const sums = new Map<string, number>()
  for (const p of postings) {
    sums.set(p.currency, (sums.get(p.currency) ?? 0) + parseFloat(p.amount))
  }
  for (const [currency, sum] of sums) {
    if (Math.abs(sum) > 0.001) {
      const detail = index === undefined ? { currency, sum } : { currency, index }
      return { ok: false, failure: errorBody('POSTINGS_DO_NOT_BALANCE', detail) }
    }
  }

  return { ok: true, value: undefined }
}
