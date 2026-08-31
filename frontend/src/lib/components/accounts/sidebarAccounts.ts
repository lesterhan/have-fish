/**
 * What the sidebar shows now that it is a launcher rather than an index.
 *
 * Two short lists instead of every account: the ones you pinned, and the ones you have been
 * transacting in. "Recent" is derived from last activity rather than from visit history on
 * purpose — recently *transacted* is close enough to recently *wanted*, it needs no new state
 * to track, and it is already fetched for the Accounts page's staleness column.
 */

import {
  ACCOUNT_SURFACES,
  accountDisplayName,
  rootFor,
  surfaceOf,
  type Roots,
} from './accountPaths'

/** The minimal shape the sidebar needs from `GET /api/accounts`. */
export interface SidebarAccount {
  id: string
  path: string
  name?: string | null
}

export interface SidebarRow {
  id: string
  path: string
  label: string
}

/**
 * How many recent accounts to show. A constant to tune in use rather than a setting: nobody
 * wants a preferences screen for the length of a list they can see.
 */
export const RECENT_LIMIT = 3

function toRow(account: SidebarAccount, roots: Roots): SidebarRow {
  const surface = surfaceOf(account.path, roots)
  return {
    id: account.id,
    path: account.path,
    label: accountDisplayName(account, rootFor(surface, roots)),
  }
}

/**
 * Pinned accounts, in the order they were pinned.
 *
 * Ids that no longer resolve are dropped rather than rendered as blanks — an account can be
 * deleted while its id sits in preferences, and a pin is not worth a write to clean up.
 */
export function pinnedRows(
  accounts: readonly SidebarAccount[],
  pinnedIds: readonly string[],
  roots: Roots,
): SidebarRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  return pinnedIds
    .map((id) => byId.get(id))
    .filter((a): a is SidebarAccount => a !== undefined)
    .map((a) => toRow(a, roots))
}

/**
 * The most recently transacted accounts, newest first.
 *
 * Scoped to balance-bearing accounts: last activity across everything would rank
 * `expenses:food:groceries` top, and "recent" in a nav means somewhere you go, not a category
 * a posting landed in. Pinned and hidden accounts are excluded — a pin already has a row, and
 * hiding one is a request not to see it.
 */
export function recentRows(
  accounts: readonly SidebarAccount[],
  lastActivityById: ReadonlyMap<string, string | null>,
  roots: Roots,
  exclude: { pinnedIds: ReadonlySet<string>; hiddenIds: ReadonlySet<string> },
  limit = RECENT_LIMIT,
): SidebarRow[] {
  return accounts
    .filter(
      (a) =>
        !exclude.pinnedIds.has(a.id) &&
        !exclude.hiddenIds.has(a.id) &&
        ACCOUNT_SURFACES.includes(surfaceOf(a.path, roots)) &&
        (lastActivityById.get(a.id) ?? null) !== null,
    )
    .sort((a, b) => {
      const av = lastActivityById.get(a.id)!
      const bv = lastActivityById.get(b.id)!
      // Same-day ties fall back to the path so the order is stable between renders.
      return bv.localeCompare(av) || a.path.localeCompare(b.path)
    })
    .slice(0, limit)
    .map((a) => toRow(a, roots))
}
