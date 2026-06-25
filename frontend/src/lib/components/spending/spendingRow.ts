// Display + summing logic for the spending right-panel rows, derived from the shared
// posting-role classification (narrate.ts / backend roles) instead of the old bespoke
// `startsWith('expenses:')` heuristics that drifted from the real classifier. Pure (no
// Svelte) so it is unit-tested against the canonical transaction shapes.

import type { Transaction, Posting } from '$lib/api'
import { narrateTransaction } from '../transactions/narrate'

// The largest-abs subject leg — the meaningful spend shown as the row headline. Role-based,
// so a fee or conversion leg never masquerades as the spend (the old heuristic counted any
// `expenses:`-rooted leg, including the Wise fee). Null when the transaction has no subject
// leg (e.g. a pure transfer that slipped into the list); callers fall back to the first leg.
export function headlineSubject(tx: Transaction): Posting | null {
  const { subjects } = narrateTransaction(tx.postings)
  if (subjects.length === 0) return null
  return subjects.reduce((best, p) =>
    Math.abs(parseFloat(p.amount)) > Math.abs(parseFloat(best.amount)) ? p : best,
  )
}

// The account the money came out of (narration source), for the "from → to" row subtitle.
export function rowSource(tx: Transaction): Posting | null {
  return narrateTransaction(tx.postings).movement.source
}

// Drop the root segment of an account path for the compact row label: `expenses:food:cafe`
// → `food:cafe`, `assets:wise:cad` → `wise:cad`.
export function stripRoot(accountPath: string): string {
  return accountPath.split(':').slice(1).join(':')
}

// True when the transaction has a subject leg in the given currency — the filter the
// currency chips apply. `ALL` matches any transaction with at least one subject leg.
export function hasSubjectInCurrency(tx: Transaction, currency: string): boolean {
  const { subjects } = narrateTransaction(tx.postings)
  if (currency === 'ALL') return subjects.length > 0
  return subjects.some((p) => p.currency === currency)
}

// Sum of a transaction's subject legs converted to the preferred currency, optionally
// limited to one currency. Mirrors the story-1 spending aggregate: only subject legs count,
// so a cross-currency spend is not doubled by its mechanical conversion/transfer/fee legs.
export function txSubjectTotal(
  tx: Transaction,
  fxRates: Record<string, number>,
  currencyFilter: string,
): number {
  const { subjects } = narrateTransaction(tx.postings)
  const legs =
    currencyFilter === 'ALL'
      ? subjects
      : subjects.filter((p) => p.currency === currencyFilter)
  return legs.reduce(
    (sum, p) => sum + Math.abs(parseFloat(p.amount)) * (fxRates[p.currency] ?? 1),
    0,
  )
}
