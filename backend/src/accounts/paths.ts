// Account paths: what a valid one looks like, when two are the same, the one namespace the app
// keeps for itself, and what a rename does to a subtree. Pure: the account service loads the
// rows and writes the result, and this decides.

import { errorBody, type Outcome } from '../errors'

// A valid account path is colon-segmented with no empty segments and no surrounding
// whitespace — rejects '', ':x', 'x:', 'x::y'.
export function isValidPath(path: string): boolean {
  if (path !== path.trim() || path.length === 0) return false
  return path.split(':').every((seg) => seg.length > 0 && seg === seg.trim())
}

/**
 * The form two paths are compared in. Paths ignore case (#480): `assets:wise` and `assets:Wise`
 * are one account, and the path keeps the spelling it was typed with for display and for the
 * hledger export.
 *
 * Computed here and stored as `accounts.path_key`, never with SQL's `lower()`: SQLite's
 * lowercases ASCII only and Postgres's all of Unicode, so `expenses:CAFÉ` would be one account
 * on the server and two on the laptop. One function in one language keeps both agreeing.
 */
export function pathKey(path: string): string {
  return path.toLowerCase()
}

/** Every node of a path, root first: `a:b:c` gives `a`, `a:b`, `a:b:c`. */
function nodesOf(path: string): string[] {
  const segments = path.split(':')
  return segments.map((_, i) => segments.slice(0, i + 1).join(':'))
}

/**
 * Why `candidate` cannot join `existing`, as the path already there, or `undefined` when it can.
 *
 * Two rules, and the second is the one a unique index cannot hold:
 * - no two accounts share a key, so `assets:wise` twice and `assets:wise` beside `assets:Wise`
 *   are both refused;
 * - every node of the tree has one spelling, so `assets:Wise:eur` is refused beside
 *   `assets:wise` too. Without it, "at or under `assets:wise`" compared by key would sweep in
 *   `assets:Wise:eur`'s postings while the tree showed them as two siblings, and a report would
 *   disagree with the screen it was drilled from.
 *
 * Adding a row at a node that exists only as a grouping (`assets:wise` when only
 * `assets:wise:eur` exists) is fine: same spelling, no account at that key yet.
 */
export function pathTakenBy(existing: readonly string[], candidate: string): string | undefined {
  return takenIn(existing)(candidate)
}

/** `pathTakenBy` with `existing` indexed once, for checking many candidates against it. */
function takenIn(existing: readonly string[]): (candidate: string) => string | undefined {
  const nodeSpelling = new Map<string, string>()
  const accountAt = new Map<string, string>()
  for (const path of existing) {
    accountAt.set(pathKey(path), path)
    for (const node of nodesOf(path)) {
      const key = pathKey(node)
      if (!nodeSpelling.has(key)) nodeSpelling.set(key, node)
    }
  }
  return (candidate) => {
    // The whole path first: `assets:wise:eur` already there says more than its root does.
    const whole = accountAt.get(pathKey(candidate))
    if (whole !== undefined) return whole
    for (const node of nodesOf(candidate)) {
      const there = nodeSpelling.get(pathKey(node))
      if (there !== undefined && there !== node) return there
    }
    return undefined
  }
}

/**
 * Every node spelled more than one way across `paths`, each with all its spellings. Empty for
 * any set of paths written since #480; the pre-deploy check reads existing data with it.
 */
export function spellingConflicts(paths: Iterable<string>): string[][] {
  const byKey = new Map<string, Set<string>>()
  for (const path of paths) {
    for (const node of nodesOf(path)) {
      const key = pathKey(node)
      const seen = byKey.get(key) ?? new Set<string>()
      seen.add(node)
      byKey.set(key, seen)
    }
  }
  return [...byKey.values()].filter((s) => s.size > 1).map((s) => [...s].sort())
}

// Clearing-account path scheme. A member's per-group clearing account nets what the
// group owes them (positive) against what they owe the group (negative) — a single
// receivable account per group. Fish Pie creates them (`fish-pie-accounts-service.ts`); the
// personal ledger only has to keep people out of the namespace, which is why the rule
// lives here rather than with Fish Pie.
export const CLEARING_PREFIX = 'assets:receivable'

// True for the receivable namespace itself and anything under it. Clearing accounts are
// system-managed, so this gates both path-matching over postings (the import-linked PATCH
// rebuild) and the surfaces that only make sense for accounts a human imports into.
// Anchored on the colon, so `assets:receivables-ledger` is an ordinary account. Compared by
// key, so `Assets:Receivable:x` is in the namespace too.
export function isClearingAccountPath(path: string): boolean {
  const key = pathKey(path)
  return key === CLEARING_PREFIX || key.startsWith(`${CLEARING_PREFIX}:`)
}

// Exactly `prefix`, or a descendant `prefix:...`. Anchored on the colon, so `expenses:food`
// is not a prefix of `expenses:foodcourt`.
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}:`)
}

/** One account's new path. */
export type Rewrite = { id: string; newPath: string }

/**
 * What renaming the prefix `from` to `to` does to a user's active accounts: the new path of
 * the node itself and of every descendant.
 *
 * A leaf rename is the degenerate case (an exact match, no descendants); a parent rename
 * cascades. Matching is on the materialized path, not on ids, so a virtual grouping node (a
 * segment with no row of its own) renames too, by way of its children.
 *
 * Refused, in this order:
 * - `to` is `from`, or not a valid path;
 * - either side is in the receivable namespace, which Fish Pie manages and re-spawns;
 * - nothing sits at or under `from`;
 * - a new path is taken by an account outside the moved subtree, by `pathTakenBy`'s rules, so
 *   ignoring case and counting a node spelled differently. Taking a whole path would be a
 *   merge, and merging is not what a rename does. A path inside the subtree is free, because
 *   it moves too: renaming `a` to `a:b` over `a` and `a:b` gives `a:b` and `a:b:b`, and
 *   renaming `assets:wise` to `assets:Wise` changes only its case.
 *
 * `accounts` is every active account the user has. Matching happens here rather than in SQL
 * so that `_` and `%` in a path mean nothing special, and the anchoring stays exact.
 */
export function planRename(
  accounts: readonly { id: string; path: string }[],
  from: string,
  to: string,
): Outcome<Rewrite[]> {
  if (from === to) return { ok: false, failure: errorBody('RENAME_TARGET_SAME_AS_SOURCE') }
  if (!isValidPath(to)) return { ok: false, failure: errorBody('RENAME_TARGET_INVALID') }
  if (isClearingAccountPath(from)) {
    return { ok: false, failure: errorBody('RECEIVABLE_NOT_RENAMABLE') }
  }
  if (isClearingAccountPath(to)) {
    return { ok: false, failure: errorBody('RECEIVABLE_NOT_A_RENAME_TARGET') }
  }

  const matched = accounts.filter((a) => isUnder(a.path, from))
  if (matched.length === 0) return { ok: false, failure: errorBody('RENAME_NO_MATCH') }

  const matchedIds = new Set(matched.map((a) => a.id))
  const staying = accounts.filter((a) => !matchedIds.has(a.id)).map((a) => a.path)

  const rewrites = matched.map((a) => ({ id: a.id, newPath: `${to}${a.path.slice(from.length)}` }))
  const taken = takenIn(staying)
  for (const r of rewrites) {
    const existing = taken(r.newPath)
    if (existing !== undefined) {
      return { ok: false, failure: errorBody('RENAME_TARGET_EXISTS', { path: existing }) }
    }
  }
  return { ok: true, value: rewrites }
}
