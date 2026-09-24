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

import {
  type AccountType,
  type StoredAccountType,
  toClassifierType,
  type UserSettings,
} from '../../api'
// Relative, not `$lib`: this module is unit-tested directly. See lib-imports.test.ts.
import { accountsCopy } from '../../copy/accounts'

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
 * `unfiled` is the safety net: an account the app has no answer for — outside *every*
 * configured root and carrying no type override. The Settings list used to be the surface that
 * showed literally every path, so without this bucket a mis-pathed account would simply vanish
 * from the app. Tagging one is how it leaves the bucket.
 */
export type Surface = 'assets' | 'liabilities' | 'equity' | 'expenses' | 'income' | 'unfiled'

/**
 * The heading each surface gets. A mapping from the taxonomy to the words, which is why it
 * lives here and the words do not — `unfiled` is a bucket this file invented, and its name
 * is a copy decision like any other.
 */
export const SURFACE_LABEL: Record<Surface, string> = {
  ...accountsCopy.groups.surface,
  unfiled: accountsCopy.groups.unfiled,
}

/** Surfaces the Accounts tab renders. Expenses and income belong to Categories. */
export const ACCOUNT_SURFACES: readonly Surface[] = ['assets', 'liabilities', 'equity', 'unfiled']

/**
 * The minimal shape every surface question is really asked about.
 *
 * `resolvedType` is what `GET /api/accounts` and `GET /api/accounts/balances` both report:
 * the account's own override, else its nearest tagged ancestor's, else what the path root
 * infers. Optional because a caller may be
 * holding a payload that predates the field; absent means "ask the path", which is exactly
 * what this module did before the field existed.
 */
export interface TypedAccount {
  path: string
  resolvedType?: StoredAccountType | null | undefined
}

/** Which surface each coarse type belongs to. The one place the two vocabularies meet. */
const SURFACE_FOR_TYPE: Record<AccountType, Surface> = {
  asset: 'assets',
  liability: 'liabilities',
  equity: 'equity',
  expense: 'expenses',
  income: 'income',
}

/**
 * What the path alone says. `unfiled` when it is under no configured root.
 *
 * This is the *fallback*, not the answer: an account carrying a type override is that type
 * wherever it sits, and `surfaceOf` is the function that knows it. Reach for this one only
 * when there is genuinely no account to ask — a bare path from a picker, a posting's path.
 */
export function surfaceOfPath(path: string, roots: Roots): Surface {
  if (isUnderRoot(path, roots.assets)) return 'assets'
  if (isUnderRoot(path, roots.liabilities)) return 'liabilities'
  if (isUnderRoot(path, roots.equity)) return 'equity'
  if (isUnderRoot(path, roots.expenses)) return 'expenses'
  if (isUnderRoot(path, roots.income)) return 'income'
  return 'unfiled'
}

/**
 * Which part of the app owns an account: its resolved type when it has one, else its path.
 *
 * The override wins, and it wins in both directions. A wallet at `储蓄:现金` tagged Cash is
 * an asset and belongs on the Accounts tab — the bug this exists to fix, where the one field
 * whose whole purpose is to classify an atypical path changed nothing about where the account
 * appeared. An account under the assets root tagged Expense is a category, and counting it as
 * money because of where it sits is the same mistake read backwards.
 *
 * Cash collapses to Asset and Conversion to Equity through `toClassifierType`, so the two
 * hledger subtypes land with their parents rather than inventing surfaces of their own.
 */
export function surfaceOf(account: TypedAccount, roots: Roots): Surface {
  const resolved = account.resolvedType
  if (resolved) return SURFACE_FOR_TYPE[toClassifierType(resolved)]
  return surfaceOfPath(account.path, roots)
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

/**
 * Null for anything unfiled or non-balance-bearing: it feeds no bucket.
 *
 * Owed is still read from the path, and deliberately: `assets:receivable:*` is a subtree Fish
 * Pie mints itself, not a type anyone tags. An asset that got here through an override has no
 * such subtree to sit in, and counts as spendable.
 */
export function bucketOf(account: TypedAccount, roots: Roots): PositionBucket | null {
  switch (surfaceOf(account, roots)) {
    case 'assets':
      return isUnderRoot(account.path, `${roots.assets}${SEP}${RECEIVABLE_SEGMENT}`)
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
  account: { path: string; name?: string | null | undefined },
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
