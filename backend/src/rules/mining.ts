// Mining suggested rules from the ledger: which description keeps landing in which expense
// account. Pure: `rule-service.ts` loads the legs and the existing rules and writes what
// this returns.

import { merchantKey } from '../import/merchant'
import {
  accountTypeOf,
  type ClassifySettings,
  classifyPosting,
  isExpenseSubject,
  type RolePosting,
} from '../postings/roles'

// Below this many matching transactions a pattern is not suggested. 2 rather than 3 lets a
// first-ever import surface rules; normalization means a "2" is a genuine repeat of the same
// merchant, not two unrelated reference-laden descriptions.
export const MIN_MATCHES = 2

// The legs of one transaction that say which expense account its description maps to.
//
// By RESOLVED type, not by the expenses root: a tagged category at an atypical root is as
// much a spend as one under `expenses:`, and a bare `expenses` account is one too. A Fish Pie
// clearing leg is never the answer, whatever it is tagged. When a transaction also carries a
// designated fee or conversion leg of expense type — a Wise spend with its fee — the spend is
// the leg that means something, so the plumbing is set aside; a transaction that is *only* a
// fee still maps to the fee account, because that is what its description is about.
export function expenseLegs(legs: RolePosting[], settings: ClassifySettings): RolePosting[] {
  const typed = legs.filter(
    (p) => accountTypeOf(p, settings) === 'expense' && classifyPosting(p, settings) !== 'share',
  )
  const spends = typed.filter((p) => isExpenseSubject(p, settings))
  return spends.length > 0 ? spends : typed
}

/** A rule to suggest: a pattern, the account it maps to, and how often it did. */
export type Suggestion = { pattern: string; accountId: string; count: number }

/**
 * The rules worth suggesting.
 *
 * - A transaction counts when it has a description and exactly one expense leg. That admits
 *   Fish Pie and multi-currency conversions (several legs, one expense), not only plain
 *   two-leg spends; zero or several expense legs say nothing about which account a pattern
 *   maps to.
 * - Descriptions are normalized by `merchantKey`, the same key the import preview stamps, so
 *   a mined pattern and the preview cluster it covers are one string, and near-duplicates
 *   from one merchant count together.
 * - For each pattern (ignoring case) the account it went to most often wins.
 * - A pattern already covered by a rule, `covered` (lowercased), is skipped, and so is one
 *   seen fewer than `MIN_MATCHES` times.
 */
export function mineSuggestions(
  transactions: Iterable<{ description: string | null; postings: RolePosting[] }>,
  settings: ClassifySettings,
  covered: ReadonlySet<string>,
): Suggestion[] {
  const pairCounts = new Map<string, Suggestion>()
  for (const { description, postings } of transactions) {
    if (!description) continue
    const legs = expenseLegs(postings, settings)
    const leg = legs[0]
    if (legs.length !== 1 || !leg) continue
    const pattern = merchantKey(description)
    if (!pattern) continue
    const key = `${pattern.toLowerCase()}|||${leg.accountId}`
    const existing = pairCounts.get(key)
    if (existing) existing.count++
    else pairCounts.set(key, { pattern, accountId: leg.accountId, count: 1 })
  }

  const bestByPattern = new Map<string, Suggestion>()
  for (const pair of pairCounts.values()) {
    const patternKey = pair.pattern.toLowerCase()
    const current = bestByPattern.get(patternKey)
    if (!current || pair.count > current.count) bestByPattern.set(patternKey, pair)
  }

  return [...bestByPattern.values()].filter(
    (pair) => pair.count >= MIN_MATCHES && !covered.has(pair.pattern.toLowerCase()),
  )
}
