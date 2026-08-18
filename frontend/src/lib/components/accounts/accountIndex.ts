// ════════════════════════════════════════════════════════════
//  ACCOUNT INDEX
//
//  Every AccountPicker needs the same three lookups over the same account
//  list: the drill tree, path → account, and id → account. Built per
//  instance that is O(rows × accounts) — the import review table mounts one
//  picker per row, so a 200-row import rebuilt the tree 200 times over an
//  identical array, and did it again on every account creation (which
//  replaces the array).
//
//  The list is immutable by convention (callers replace it, never mutate in
//  place), so array identity is a sound cache key: a new array means new
//  contents, and the same array means the index still holds. A WeakMap keeps
//  the entry alive only as long as the caller's array is.
// ════════════════════════════════════════════════════════════

import { buildTree, type AccountTree } from './accountTree'

/** The minimal shape the index needs. `Account` from the API satisfies it. */
export interface IndexedAccount {
  id: string
  path: string
  freq?: number
}

export interface AccountIndex<A extends IndexedAccount> {
  /** Nested tree for the breadcrumb-drill column. */
  tree: AccountTree
  /** Full path → account. Pure parent paths are absent. */
  byPath: Map<string, A>
  /** Account id → account. */
  byId: Map<string, A>
}

const cache = new WeakMap<readonly IndexedAccount[], AccountIndex<IndexedAccount>>()

/**
 * Tree + lookup maps for `accounts`, memoized on the array's identity.
 *
 * Mutating an array in place after indexing it returns a stale index — always
 * replace the array (`accounts = [...accounts, next]`) instead.
 */
export function accountIndex<A extends IndexedAccount>(accounts: readonly A[]): AccountIndex<A> {
  const hit = cache.get(accounts)
  if (hit) return hit as AccountIndex<A>

  const built: AccountIndex<A> = {
    tree: buildTree(accounts),
    byPath: new Map(accounts.map((a) => [a.path, a] as const)),
    byId: new Map(accounts.map((a) => [a.id, a] as const)),
  }
  cache.set(accounts, built as AccountIndex<IndexedAccount>)
  return built
}
