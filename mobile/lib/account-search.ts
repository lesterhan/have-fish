/**
 * Account search / create logic for the Companion account selector — RN-free so
 * it can be bun-tested without a renderer (mirrors `lib/currency.ts` and
 * `lib/server-url.ts`). The UI in `components/AccountSelect.tsx` renders purely
 * from these helpers; SecureStore / network I/O stays at the call site.
 *
 * Accounts are identified by a colon-separated materialized path that doubles as
 * the hledger account name (`expenses:groceries:veg`). The **root** is the first
 * path segment; the root chips scope by the account's resolved type, which the
 * server works out from the stored override and the user's configured roots.
 */

import type { StoredAccountType } from './api'

/** A ledger account, structurally — the subset this module needs. */
export interface AccountLike {
  id: string
  path: string
  name?: string | null | undefined
  /**
   * Own override, else nearest tagged ancestor's, else path inference against the
   * user's configured roots,
   * as `GET /api/accounts` serves it. Absent on an account the server has not
   * described (one created a moment ago), where the path is all there is.
   */
  resolvedType?: StoredAccountType | null | undefined
}

/**
 * The five canonical root types, in accounting order. Shown as scope chips and
 * used to seed the path prefix when creating from a bare leaf. Fixed (not
 * derived from the data) so the chip row is stable even on an empty ledger.
 */
export const ROOTS = ['assets', 'liabilities', 'expenses', 'income', 'equity'] as const
export type Root = (typeof ROOTS)[number]

/**
 * Which chip each type belongs under. Cash is an asset and Conversion is
 * equity, the same collapse the backend's `toClassifierType` makes.
 */
const ROOT_FOR_TYPE: Record<StoredAccountType, Root> = {
  asset: 'assets',
  cash: 'assets',
  liability: 'liabilities',
  equity: 'equity',
  conversion: 'equity',
  expense: 'expenses',
  income: 'income',
}

/**
 * Whether an account belongs under a root chip. By resolved type when the
 * server gave one, so `花钱:房租` tagged Expense sits under Expenses and
 * `expenses:rrsp` tagged Asset does not — and so a user whose expenses root is
 * `cost` finds `cost:food` there too. The first path segment is the fallback
 * for an account with no type to ask, not the rule.
 */
export function inRoot(account: AccountLike, root: string): boolean {
  const r = root.trim().toLowerCase()
  const type = account.resolvedType
  if (type) return ROOT_FOR_TYPE[type] === r
  return rootOf(account.path) === r
}

/** First path segment = the account's root (lowercased, trimmed). */
export function rootOf(path: string): string {
  return path.split(':')[0]?.trim().toLowerCase() ?? ''
}

/**
 * Display label for an account: its human name when set, else the last path
 * segment (the leaf), falling back to the whole path for a rootless string.
 */
export function accountLeaf(a: AccountLike): string {
  const name = a.name?.trim()
  if (name) return name
  const segments = a.path.split(':')
  return segments[segments.length - 1]?.trim() || a.path
}

/**
 * Subsequence fuzzy match: every char of `needle` appears in `haystack` in
 * order (not necessarily adjacent). Case-insensitive. Empty needle matches
 * everything. Mirrors the web `AccountPathInput` matcher so the two feel the
 * same — e.g. "exveg" matches "expenses:groceries:veg".
 */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  let hi = 0
  let ni = 0
  while (hi < h.length && ni < n.length) {
    if (h[hi] === n[ni]) ni++
    hi++
  }
  return ni === n.length
}

/**
 * The accounts to show, given a free-text query and an optional root scope.
 * Scoped to `root` first (see `inRoot`), then fuzzy-filtered over both
 * path and name, then sorted by path so siblings cluster. An empty query (after
 * scoping) returns the whole scope, sorted.
 */
export function filterAccounts(
  accounts: AccountLike[],
  query: string,
  root?: string,
): AccountLike[] {
  const q = query.trim()
  return accounts
    .filter((a) => (root?.trim() ? inRoot(a, root) : true))
    .filter((a) => (q ? fuzzyMatch(a.path, q) || fuzzyMatch(a.name ?? '', q) : true))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Resolve the path a "create" action would produce from the typed text and the
 * active root scope. If the text already begins with a known root segment it is
 * taken as a full path; otherwise the active root (if any) is prepended so the
 * user can type just the leaf (`groceries:veg` under the `expenses` chip →
 * `expenses:groceries:veg`). Returns `''` for blank input.
 */
export function resolveCreatePath(input: string, root?: string): string {
  const t = input.trim().replace(/:+$/, '').replace(/^:+/, '').trim()
  if (!t) return ''
  const first = t.split(':')[0]?.trim().toLowerCase()
  if ((ROOTS as readonly string[]).includes(first ?? '')) return t
  const r = root?.trim().toLowerCase()
  return r ? `${r}:${t}` : t
}

/**
 * Whether to offer an inline "create" row, and the path it would create. Offered
 * when the resolved path is non-empty and no existing account already has that
 * exact path (case-insensitive). Returns `null` when create should be hidden.
 */
export function createSuggestion(
  accounts: AccountLike[],
  input: string,
  root?: string,
): { path: string } | null {
  const path = resolveCreatePath(input, root)
  if (!path) return null
  const exists = accounts.some((a) => a.path.trim().toLowerCase() === path.toLowerCase())
  return exists ? null : { path }
}
