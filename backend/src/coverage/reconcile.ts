// What a reconcile adds to an account's coverage.
//
// Reconciling to D means the ledger agrees with the bank at D by construction — either the
// balances already matched, or the adjustment posting made them match. That is the strongest
// evidence of completeness the app can ever have, so it is recorded as an assertion.
//
// The start is derived rather than asked for: coverage continues from wherever it left off,
// so the user is never made to answer a question the data already answers.

import { addDays, type CoverageInterval, mergeCoverage } from './intervals'

/** The last day any assertion reaches, or null when the account has none. */
export function coveredThrough(intervals: readonly CoverageInterval[]): string | null {
  return mergeCoverage([...intervals]).at(-1)?.throughDate ?? null
}

/**
 * The interval a reconcile to `throughDate` records, or null when coverage already reaches
 * it. Such a reconcile is still real evidence, but it asserts nothing the log does not already
 * hold, and a backwards or zero-length interval would only add noise.
 *
 * Coverage picks up the day after it stops. With no coverage at all it starts at the
 * account's first transaction, since everything before that is vacuously complete; with no
 * transactions either, the reconcile speaks only for `throughDate`. A first transaction dated
 * after `throughDate` is clamped to it rather than written as an inverted range, which the
 * table's check constraint would refuse.
 *
 * `firstTxnDate` is only read when there is no coverage, so a caller may skip the query that
 * finds it otherwise.
 */
export function reconcileInterval(
  covered: string | null,
  throughDate: string,
  firstTxnDate: string | null,
): CoverageInterval | null {
  if (covered !== null && covered >= throughDate) return null
  const fromDate = covered !== null ? addDays(covered, 1) : (firstTxnDate ?? throughDate)
  return { fromDate: fromDate > throughDate ? throughDate : fromDate, throughDate }
}
