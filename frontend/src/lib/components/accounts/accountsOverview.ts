// ════════════════════════════════════════════════════════════
//  ACCOUNTS OVERVIEW
//
//  The Accounts page's own model: turning the balances payload into rows,
//  arranging those rows into groups, and rolling them up into the position row.
//
//  What a path *means* lives in accountPaths.ts and how money adds up lives in
//  $lib/money.ts — both are used by other surfaces. What is left here is only
//  the shape this page renders.
// ════════════════════════════════════════════════════════════

// Relative, not `$lib`: this module is unit-tested directly, and a value import through the
// alias has no .svelte-kit to resolve against in CI. See lib-imports.test.ts.
import { toClassifierType, type StoredAccountType } from '../../api'
import {
  convertBalances,
  type Converted,
  type Money,
  type Rates,
} from '../../money'
import {
  SURFACE_LABEL,
  UNFILED_LABEL,
  bucketOf,
  accountDisplayName,
  institutionOf,
  rootFor,
  surfaceOf,
  type PositionBucket,
  type Roots,
  type Surface,
} from './accountPaths'

// ── Rows ────────────────────────────────────────────────────

/** The shape the page needs from `GET /api/accounts/balances`. */
export interface OverviewAccount {
  id: string
  path: string
  name?: string | null
  resolvedType?: StoredAccountType | null
  balances: Money[]
}

export interface Row {
  account: OverviewAccount
  surface: Surface
  /** `name` when set, else the path with its root prefix stripped. */
  displayName: string
  /**
   * The balances to render for this row. Usually the account's whole set; when grouping by
   * currency it is narrowed to the one currency of the group the row sits in, so a group's
   * total is an exact native sum rather than a conversion.
   */
  balances: Money[]
  /** YYYY-MM-DD of the most recent transaction, or null for a never-used account. */
  lastActivity: string | null
  /** Whole days since `lastActivity`, or null when there is none. */
  idleDays: number | null
}

/**
 * Past this many idle days a row carries a staleness sub-label. Deliberately a blunt
 * threshold on last activity alone: real coverage state exists only for tracked accounts
 * (see the epic's Deferred section), so anything richer would show a blank on half the
 * rows and read as a bug.
 */
export const STALE_AFTER_DAYS = 45

/** Whole days between two YYYY-MM-DD dates, or null if either is missing/unparseable. */
export function daysBetween(from: string | null, to: string): number | null {
  if (!from) return null
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.floor((b - a) / 86_400_000)
}

export function buildRows(
  accounts: readonly OverviewAccount[],
  roots: Roots,
  lastActivityById: ReadonlyMap<string, string | null>,
  today: string,
): Row[] {
  return accounts.map((account) => {
    const surface = surfaceOf(account.path, roots)
    const lastActivity = lastActivityById.get(account.id) ?? null
    return {
      account,
      surface,
      displayName: accountDisplayName(account, rootFor(surface, roots)),
      balances: account.balances,
      lastActivity,
      idleDays: daysBetween(lastActivity, today),
    }
  })
}

// ── Grouping ────────────────────────────────────────────────

export type Grouping = 'institution' | 'type' | 'currency' | 'flat'

export interface Group {
  key: string
  label: string
  rows: Row[]
}

const TYPE_LABEL: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}

/** Group with no currency at all — an account that has never been posted to. */
export const NO_BALANCE_LABEL = 'No balance'

function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

/** Currencies an account holds, in the order the balances arrive, deduplicated. */
function currenciesOf(row: Row): string[] {
  const seen = new Set<string>()
  for (const b of row.account.balances) seen.add(b.currency)
  return [...seen]
}

/**
 * Sort groups by label, with Unfiled and No balance pinned last: both are "everything else"
 * buckets, and neither should push real accounts down the page.
 */
function sortGroups(groups: Group[]): Group[] {
  const trailing = (g: Group) =>
    g.key === 'unfiled' || g.key === 'currency:' ? 1 : 0
  return groups.sort(
    (a, b) => trailing(a) - trailing(b) || a.label.localeCompare(b.label),
  )
}

function sortRows(rows: Row[]): Row[] {
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

function push(map: Map<string, Group>, key: string, label: string, row: Row) {
  let group = map.get(key)
  if (!group) {
    group = { key, label, rows: [] }
    map.set(key, group)
  }
  group.rows.push(row)
}

export function groupRows(rows: readonly Row[], grouping: Grouping): Group[] {
  const map = new Map<string, Group>()

  for (const row of rows) {
    // Unfiled always wins over the chosen grouping: the point of the bucket is that these
    // rows are visibly set apart, not quietly filed under an institution or a type.
    if (row.surface === 'unfiled') {
      push(map, 'unfiled', UNFILED_LABEL, row)
      continue
    }

    switch (grouping) {
      case 'institution': {
        const inst = institutionOf(row.account.path)
        push(
          map,
          inst ? `inst:${inst}` : `surface:${row.surface}`,
          inst ? titleCase(inst) : SURFACE_LABEL[row.surface],
          row,
        )
        break
      }
      case 'type': {
        const resolved = row.account.resolvedType
        const key = resolved ? toClassifierType(resolved) : row.surface
        push(
          map,
          `type:${key}`,
          TYPE_LABEL[key] ?? SURFACE_LABEL[row.surface],
          row,
        )
        break
      }
      case 'currency': {
        const currencies = currenciesOf(row)
        if (currencies.length === 0) {
          push(map, 'currency:', NO_BALANCE_LABEL, row)
          break
        }
        // An account holding CAD and USD appears under both, each time showing only the
        // balance for that currency. That is what makes a currency group's total an exact
        // native sum — the one grouping that needs no FX rate to be trustworthy.
        for (const currency of currencies) {
          push(map, `currency:${currency}`, currency, {
            ...row,
            balances: row.account.balances.filter(
              (b) => b.currency === currency,
            ),
          })
        }
        break
      }
      case 'flat':
        push(map, 'flat', 'All accounts', row)
        break
    }
  }

  for (const group of map.values()) sortRows(group.rows)
  return sortGroups([...map.values()])
}

/**
 * The single currency every row in a group is denominated in, or null when there is no such
 * currency (any grouping but Currency, the No-balance group, and Unfiled — which catches
 * stray paths regardless of what they hold).
 *
 * This is what lets a currency group state an exact native total instead of a conversion:
 * asking "what am I still holding in CZK" should not depend on a CZK→CAD rate existing.
 */
export function groupCurrency(group: Group): string | null {
  if (!group.key.startsWith('currency:')) return null
  return group.key.slice('currency:'.length) || null
}

// ── Roll-ups ────────────────────────────────────────────────

/** Every currency appearing in these rows except the preferred one — what needs a rate. */
export function currenciesNeedingRates(
  rows: readonly Row[],
  preferred: string,
): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    for (const b of row.account.balances) {
      if (b.currency !== preferred) seen.add(b.currency)
    }
  }
  return [...seen].sort()
}

/**
 * Sum the balances these rows *display* — which is not the same as the balances their accounts
 * hold, since currency grouping narrows a row to one currency.
 */
export function convertRows(
  rows: readonly Row[],
  rates: Rates,
  preferred: string,
): Converted {
  return convertBalances(
    rows.flatMap((r) => r.balances),
    rates,
    preferred,
  )
}

/**
 * The position row. Computed over whichever rows are passed in — the page passes its
 * non-hidden accounts, so the four figures describe the money you actually track and do
 * not shift as you search or regroup.
 *
 * Balances are summed as stored, exactly as the account page and sidebar render them; no
 * sign is flipped on the way in. `owing` therefore arrives negative for a card in debt, and
 * it is the caller's job to label the direction rather than paint a minus sign.
 */
/**
 * Which accounts each position card sums, bucketed exactly as `positionTotals` buckets them.
 *
 * A tile dates itself from its own contributors, so the four dates differ and are supposed
 * to: Owed to you can be current while Available is two months behind. Deriving the ids from
 * the same `bucketOf` call is what stops a tile quoting a date computed over a different set
 * of accounts than the figure above it.
 */
export function positionAccountIds(
  rows: readonly Row[],
  roots: Roots,
): Record<PositionBucket, string[]> {
  const ids: Record<PositionBucket, string[]> = {
    cash: [],
    investments: [],
    owed: [],
    owing: [],
  }
  for (const row of rows) {
    const bucket = bucketOf(row.account.path, roots)
    if (bucket) ids[bucket].push(row.account.id)
  }
  return ids
}

export function positionTotals(
  rows: readonly Row[],
  roots: Roots,
  rates: Rates,
  preferred: string,
): Record<PositionBucket, Converted> {
  const buckets: Record<PositionBucket, Row[]> = {
    cash: [],
    investments: [],
    owed: [],
    owing: [],
  }
  for (const row of rows) {
    const bucket = bucketOf(row.account.path, roots)
    if (bucket) buckets[bucket].push(row)
  }
  return {
    cash: convertRows(buckets.cash, rates, preferred),
    investments: convertRows(buckets.investments, rates, preferred),
    owed: convertRows(buckets.owed, rates, preferred),
    owing: convertRows(buckets.owing, rates, preferred),
  }
}
