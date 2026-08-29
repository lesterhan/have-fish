// ════════════════════════════════════════════════════════════
//  ACCOUNTS OVERVIEW
//
//  The pure logic behind the Accounts page: which surface a path belongs to,
//  which position bucket it feeds, how rows group, and how native balances roll
//  up into the preferred currency.
//
//  Kept out of the component so the arithmetic and the taxonomy rules are
//  testable without mounting anything — the same split as accountScorer and
//  balanceLabel.
// ════════════════════════════════════════════════════════════

// Relative, not `$lib`: this module is unit-tested directly, and a value import through the
// alias has no .svelte-kit to resolve against in CI. See lib-imports.test.ts.
import { toClassifierType, type StoredAccountType } from '../../api'

const SEP = ':'

// ── Roots and surfaces ──────────────────────────────────────

/** The five configured root paths, as the page needs them. */
export interface Roots {
  assets: string
  liabilities: string
  equity: string
  expenses: string
  income: string
}

/**
 * Which part of the app owns an account.
 *
 * `unfiled` is the safety net: an account outside *every* configured root. The Settings
 * list used to be the surface that showed literally every path, so without this bucket
 * a mis-pathed account would simply vanish from the app — worse than the clutter the
 * page exists to fix.
 */
export type Surface =
  | 'assets'
  | 'liabilities'
  | 'equity'
  | 'expenses'
  | 'income'
  | 'unfiled'

/** Surfaces the Accounts tab renders. Everything else belongs to Categories (story 5). */
export const ACCOUNT_SURFACES: readonly Surface[] = [
  'assets',
  'liabilities',
  'equity',
  'unfiled',
]

/**
 * True when `path` is at or under `root`. The exact match matters: an account created
 * at the bare root path (`assets`) is legal, and dropping it would lose a row.
 * A configured root of `''` matches nothing rather than everything.
 */
export function isUnderRoot(path: string, root: string): boolean {
  if (!root) return false
  return path === root || path.startsWith(root + SEP)
}

export function surfaceOf(path: string, roots: Roots): Surface {
  if (isUnderRoot(path, roots.assets)) return 'assets'
  if (isUnderRoot(path, roots.liabilities)) return 'liabilities'
  if (isUnderRoot(path, roots.equity)) return 'equity'
  if (isUnderRoot(path, roots.expenses)) return 'expenses'
  if (isUnderRoot(path, roots.income)) return 'income'
  return 'unfiled'
}

// ── Position buckets ────────────────────────────────────────

/**
 * The four-way split of net position shown above the table.
 *
 * Every one of these is readable from the path already, which is the whole reason the
 * page needs no `illiquid` flag: `equity:*` is money locked up, `assets:receivable:*` is
 * money owed to you, `liabilities:*` is money you owe, and the rest of `assets:*` is what
 * you can actually spend.
 */
export type PositionBucket = 'cash' | 'investments' | 'owed' | 'owing'

/** The receivable subtree under the assets root — Fish Pie's system-managed accounts. */
export const RECEIVABLE_SEGMENT = 'receivable'

/** Null for anything unfiled or non-balance-bearing: it feeds no bucket. */
export function bucketOf(path: string, roots: Roots): PositionBucket | null {
  switch (surfaceOf(path, roots)) {
    case 'assets':
      return isUnderRoot(path, `${roots.assets}${SEP}${RECEIVABLE_SEGMENT}`)
        ? 'owed'
        : 'cash'
    case 'liabilities':
      return 'owing'
    case 'equity':
      return 'investments'
    default:
      return null
  }
}

// ── Rows ────────────────────────────────────────────────────

export interface Money {
  currency: string
  amount: string
}

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

/** Today as YYYY-MM-DD in the viewer's own timezone — "stale 3d" should match their calendar. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function rootFor(surface: Surface, roots: Roots): string {
  switch (surface) {
    case 'assets':
      return roots.assets
    case 'liabilities':
      return roots.liabilities
    case 'equity':
      return roots.equity
    case 'expenses':
      return roots.expenses
    case 'income':
      return roots.income
    default:
      return ''
  }
}

/** `assets:wise:cad` under root `assets` → `wise:cad`. Unfiled paths keep their full path. */
export function shortPath(path: string, root: string): string {
  return root && path.startsWith(root + SEP) ? path.slice(root.length + 1) : path
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
      displayName:
        account.name ?? shortPath(account.path, rootFor(surface, roots)),
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

/** Label for the bucket that catches accounts outside every configured root. */
export const UNFILED_LABEL = 'Unfiled'

const SURFACE_LABEL: Record<Surface, string> = {
  assets: 'Assets',
  liabilities: 'Liabilities',
  equity: 'Equity',
  expenses: 'Expenses',
  income: 'Income',
  unfiled: UNFILED_LABEL,
}

const TYPE_LABEL: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}

function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}

/**
 * The institution an account belongs to: path segment 2, e.g. `liabilities:wealthsimple:visa`
 * → Wealthsimple. Derived rather than modelled — it is a convention that happens to hold for
 * this data, and the Type / Currency / Flat options are the escape hatch when it does not.
 *
 * Only a path with something *below* segment 2 has one. `assets:chequing` is a standalone
 * account, not an institution holding one account — grouping it under "Chequing" would turn
 * a page of accounts into a page of one-row groups, which is the clutter this page exists to
 * remove. Those fall back to their surface ("Assets") instead.
 */
export function institutionOf(path: string): string | null {
  const segs = path.split(SEP)
  return segs.length >= 3 ? segs[1]! : null
}

/** Currencies an account holds, in the order the balances arrive, deduplicated. */
function currenciesOf(row: Row): string[] {
  const seen = new Set<string>()
  for (const b of row.account.balances) seen.add(b.currency)
  return [...seen]
}

/** Group with no currency at all — an account that has never been posted to. */
export const NO_BALANCE_LABEL = 'No balance'

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
  const code = group.key.slice('currency:'.length)
  return code || null
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

// ── Money ───────────────────────────────────────────────────

/**
 * Amounts are numeric(12,2) strings; cents keep the arithmetic exact.
 *
 * The blank check is not redundant: `Number('')` is 0, so an empty amount would otherwise
 * be summed as a real zero instead of being reported as unusable.
 */
export function toCents(amount: string): number | null {
  if (amount.trim() === '') return null
  const n = Number(amount)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '−' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${new Intl.NumberFormat('en-CA').format(whole)}.${frac}`
}

/** Currency → rate into the preferred currency. The preferred currency itself is implicit. */
export type Rates = ReadonlyMap<string, number>

export interface Converted {
  /** Total in the preferred currency, in cents, over the balances that could be converted. */
  cents: number
  /** Currencies that had no rate, so are missing from `cents`. Sorted, deduplicated. */
  missing: string[]
}

/**
 * Convert and sum. A balance whose rate is unavailable is left out of the total and named
 * in `missing` — the caller says so rather than quietly under-reporting, which is the one
 * failure mode that would make every number on the page untrustworthy.
 */
export function convertBalances(
  balances: readonly Money[],
  rates: Rates,
  preferred: string,
): Converted {
  let cents = 0
  const missing = new Set<string>()

  for (const b of balances) {
    const amount = toCents(b.amount)
    if (amount === null) {
      missing.add(b.currency)
      continue
    }
    if (b.currency === preferred) {
      cents += amount
      continue
    }
    const rate = rates.get(b.currency)
    if (rate === undefined) {
      missing.add(b.currency)
      continue
    }
    cents += Math.round(amount * rate)
  }

  return { cents, missing: [...missing].sort() }
}

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
