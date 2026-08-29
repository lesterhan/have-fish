/**
 * The account path taxonomy: what a colon-delimited path means, given the user's configured
 * root paths.
 *
 * `assets:wise:cad` is not just a label — the root says which part of the app owns it, the
 * second segment says which institution it belongs to, and together they decide which
 * position bucket its money feeds. Every one of those rules used to be written inline at each
 * call site, which is how `startsWith(`${root}:`)` ended up in four files, each subtly
 * disagreeing about whether an account sitting at the bare root counts.
 */

import type { UserSettings } from '../../api'

const SEP = ':'

// ── Roots ───────────────────────────────────────────────────

/** The five configured root paths, as the UI needs them. */
export interface Roots {
  assets: string
  liabilities: string
  equity: string
  expenses: string
  income: string
}

/** The schema defaults, for a surface that renders before settings have loaded. */
export const DEFAULT_ROOTS: Roots = {
  assets: 'assets',
  liabilities: 'liabilities',
  equity: 'equity',
  expenses: 'expenses',
  income: 'income',
}

export function rootsFrom(settings: UserSettings | null | undefined): Roots {
  return {
    assets: settings?.defaultAssetsRootPath ?? DEFAULT_ROOTS.assets,
    liabilities: settings?.defaultLiabilitiesRootPath ?? DEFAULT_ROOTS.liabilities,
    equity: settings?.defaultEquityRootPath ?? DEFAULT_ROOTS.equity,
    expenses: settings?.defaultExpensesRootPath ?? DEFAULT_ROOTS.expenses,
    income: settings?.defaultIncomeRootPath ?? DEFAULT_ROOTS.income,
  }
}

/**
 * True when `path` is at or under `root`.
 *
 * Two rules that are easy to get wrong separately: the match anchors on the separator, so
 * `assetsold:chequing` is not under `assets`; and the root itself counts, because an account
 * created at the bare root path is legal and dropping it loses a row.
 * A configured root of `''` matches nothing rather than everything.
 */
export function isUnderRoot(path: string, root: string): boolean {
  if (!root) return false
  return path === root || path.startsWith(root + SEP)
}

// ── Surfaces ────────────────────────────────────────────────

/**
 * Which part of the app owns an account.
 *
 * `unfiled` is the safety net: an account outside *every* configured root. The Settings list
 * used to be the surface that showed literally every path, so without this bucket a mis-pathed
 * account would simply vanish from the app.
 */
export type Surface =
  | 'assets'
  | 'liabilities'
  | 'equity'
  | 'expenses'
  | 'income'
  | 'unfiled'

/** Label for the bucket that catches accounts outside every configured root. */
export const UNFILED_LABEL = 'Unfiled'

export const SURFACE_LABEL: Record<Surface, string> = {
  assets: 'Assets',
  liabilities: 'Liabilities',
  equity: 'Equity',
  expenses: 'Expenses',
  income: 'Income',
  unfiled: UNFILED_LABEL,
}

/** Surfaces the Accounts tab renders. Expenses and income belong to Categories. */
export const ACCOUNT_SURFACES: readonly Surface[] = [
  'assets',
  'liabilities',
  'equity',
  'unfiled',
]

export function surfaceOf(path: string, roots: Roots): Surface {
  if (isUnderRoot(path, roots.assets)) return 'assets'
  if (isUnderRoot(path, roots.liabilities)) return 'liabilities'
  if (isUnderRoot(path, roots.equity)) return 'equity'
  if (isUnderRoot(path, roots.expenses)) return 'expenses'
  if (isUnderRoot(path, roots.income)) return 'income'
  return 'unfiled'
}

/** The configured root for a surface, or `''` for unfiled, which has none. */
export function rootFor(surface: Surface, roots: Roots): string {
  return surface === 'unfiled' ? '' : roots[surface]
}

// ── Position buckets ────────────────────────────────────────

/**
 * The four-way split of net position.
 *
 * Every one of these is readable from the path already, which is why the Accounts page needs
 * no `illiquid` flag: `equity:*` is money locked up, `assets:receivable:*` is money owed to
 * you, `liabilities:*` is money you owe, and the rest of `assets:*` is what you can spend.
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

// ── Naming ──────────────────────────────────────────────────

/** `assets:wise:cad` under root `assets` → `wise:cad`. A path not under the root is kept whole. */
export function shortPath(path: string, root: string): string {
  return root && path.startsWith(root + SEP) ? path.slice(root.length + 1) : path
}

/** What to call an account on screen: its name when it has one, else its path minus the root. */
export function accountDisplayName(
  account: { path: string; name?: string | null },
  root: string,
): string {
  return account.name ?? shortPath(account.path, root)
}

/**
 * The institution an account belongs to: path segment 2, e.g. `liabilities:wealthsimple:visa`
 * → wealthsimple. Derived rather than modelled — a convention that happens to hold for this
 * data, with grouping by type or currency as the escape hatch when it does not.
 *
 * Only a path with something *below* segment 2 has one. `assets:chequing` is a standalone
 * account, not an institution holding one account; grouping those turns a page of accounts
 * into a page of one-row groups.
 */
export function institutionOf(path: string): string | null {
  const segs = path.split(SEP)
  return segs.length >= 3 ? segs[1]! : null
}
