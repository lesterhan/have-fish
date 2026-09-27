// Account paths: what a valid one looks like, the one namespace the app keeps for itself, and
// what a rename does to a subtree. Pure: the account service loads the rows and writes the
// result, and this decides.

import { errorBody, type Outcome } from '../errors'

// A valid account path is colon-segmented with no empty segments and no surrounding
// whitespace — rejects '', ':x', 'x:', 'x::y'.
export function isValidPath(path: string): boolean {
  if (path !== path.trim() || path.length === 0) return false
  return path.split(':').every((seg) => seg.length > 0 && seg === seg.trim())
}

// Clearing-account path scheme. A member's per-group clearing account nets what the
// group owes them (positive) against what they owe the group (negative) — a single
// receivable account per group. Fish Pie creates them (`fish-pie-accounts.ts`); the
// personal ledger only has to keep people out of the namespace, which is why the rule
// lives here rather than with Fish Pie.
export const CLEARING_PREFIX = 'assets:receivable'

// True for the receivable namespace itself and anything under it. Clearing accounts are
// system-managed, so this gates both path-matching over postings (the import-linked PATCH
// rebuild) and the surfaces that only make sense for accounts a human imports into.
// Anchored on the colon, so `assets:receivables-ledger` is an ordinary account.
export function isClearingAccountPath(path: string): boolean {
  return path === CLEARING_PREFIX || path.startsWith(`${CLEARING_PREFIX}:`)
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
 * - a new path is taken by an account outside the moved subtree. That would be a merge, and
 *   merging is not what a rename does. A path inside the subtree is free, because it moves
 *   too: renaming `a` to `a:b` over `a` and `a:b` gives `a:b` and `a:b:b`.
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
  const staying = new Set(accounts.filter((a) => !matchedIds.has(a.id)).map((a) => a.path))

  const rewrites = matched.map((a) => ({ id: a.id, newPath: `${to}${a.path.slice(from.length)}` }))
  const collision = rewrites.find((r) => staying.has(r.newPath))
  if (collision) {
    return { ok: false, failure: errorBody('RENAME_TARGET_EXISTS', { path: collision.newPath }) }
  }
  return { ok: true, value: rewrites }
}
