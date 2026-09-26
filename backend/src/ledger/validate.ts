import { isValidCurrency } from '../currencies'
import { errorBody, type Outcome } from '../errors'
import { parse } from '../money'

/** One leg of a transaction as a caller proposes it, before anything is written. */
export type PostingDraft = { accountId: string; amount: string; currency: string }

/**
 * Whether a set of postings may be written as one transaction:
 *
 * 1. at least two postings, because a single leg moves money from nowhere;
 * 2. every currency is one this ledger supports;
 * 3. every amount is a number the amount column can hold;
 * 4. within each currency, the amounts sum to exactly zero, in cents. Currencies are never
 *    netted against each other; a conversion balances because it carries a leg in each
 *    currency.
 *
 * The checks run in that order and the first failure is the answer. Pure: no database,
 * no request. That's what lets a device run the same rule on a document it received.
 *
 * `index` is the transaction's position in a batch. When present it is carried into every
 * failure so the client can say which entry is wrong. A batch has never reported `sum` for
 * an unbalanced entry and a single transaction always has; both are kept as they were.
 *
 * Each amount is rounded to the cent exactly as the column will round it on write
 * (`money.parse`), so a transaction that passes is one whose stored legs balance, with no
 * tolerance. Before #279 this was `parseFloat` with a 0.001 tolerance, which passed
 * `0.005` against `-0.004` (stored as 0.01 and 0.00) and passed `NaN`, which Postgres stores.
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
    const cents = parse(p.amount)
    if (cents === null) {
      return { ok: false, failure: errorBody('AMOUNT_INVALID', { amount: p.amount, ...at }) }
    }
    sums.set(p.currency, (sums.get(p.currency) ?? 0) + cents)
  }
  for (const [currency, cents] of sums) {
    if (cents !== 0) {
      const sum = cents / 100
      const detail = index === undefined ? { currency, sum } : { currency, index }
      return { ok: false, failure: errorBody('POSTINGS_DO_NOT_BALANCE', detail) }
    }
  }

  return { ok: true, value: undefined }
}
