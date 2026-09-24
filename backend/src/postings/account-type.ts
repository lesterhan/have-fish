// Shared account-type resolver.
//
// An account's TYPE is a permanent property of the account (is it an asset, a liability,
// an expense, …) — distinct from a posting's ROLE, which is the job one leg does inside a
// single transaction (see roles.ts). Type is an input to role classification.
//
// The type is the stored `accounts.type` override when the account carries one; else the
// override of its nearest tagged ancestor; else what its path root INFERS against the user's
// configured root paths. `resolveStoredOrInferredType` is that rule; `resolveAccountType` is
// root inference alone.
//
// Inheritance is hledger's own rule — subaccounts take their parent's declared type unless
// they declare one — and decision #412 adopted it so the app agrees with the journal it
// exports. It also makes root inference a special case rather than a second mechanism: a
// configured root is an ancestor with a type. The walk goes up the path one level at a time,
// and at each level a tag on an account there beats a configured root there; the nearest level
// with either wins.
//
// A view that classifies by path root rather than through the resolver is BUG-007, whichever
// surface it is on.

// The five types path INFERENCE can produce. These are the coarse buckets the role
// classifier and balances views reason in. (`income` is hledger's documented alias for
// Revenue.)
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

// The full hledger account-type set a manual STORED override may hold. Superset of the
// inferred five, adding Cash (a subtype of Asset) and Conversion (a subtype of Equity) —
// inference can never produce these, so they are override-only. The journal serializer maps
// each to its hledger code (cash→C, conversion→V, income→R, …); the classifier collapses the
// two extras back to their parent bucket via `toClassifierType`.
export type StoredAccountType = AccountType | 'cash' | 'conversion'

// The five inferable types — for validating an inferred value.
export const ACCOUNT_TYPES: readonly AccountType[] = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
]

// The seven valid stored-override values — for validating the stored column or API input.
export const STORED_ACCOUNT_TYPES: readonly StoredAccountType[] = [
  'asset',
  'cash',
  'liability',
  'equity',
  'income',
  'expense',
  'conversion',
]

// Type guard for one of the five inferable types.
export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)
}

// Type guard for a stored override value (the full seven-type set).
export function isStoredAccountType(value: unknown): value is StoredAccountType {
  return typeof value === 'string' && (STORED_ACCOUNT_TYPES as readonly string[]).includes(value)
}

// Collapses a stored override to the coarse bucket the role classifier and balances views use:
// Cash is an Asset, Conversion is Equity, everything else maps to itself.
export function toClassifierType(type: StoredAccountType): AccountType {
  if (type === 'cash') return 'asset'
  if (type === 'conversion') return 'equity'
  return type
}

// The per-user root paths the resolver matches against. Mirrors the userSettings columns.
export type AccountTypeRoots = {
  assetsRootPath: string
  liabilitiesRootPath: string
  equityRootPath: string
  expensesRootPath: string
  incomeRootPath: string
}

// Matches the schema defaults — used as the fallback when a user has no settings row.
export const DEFAULT_ROOTS: AccountTypeRoots = {
  assetsRootPath: 'assets',
  liabilitiesRootPath: 'liabilities',
  equityRootPath: 'equity',
  expensesRootPath: 'expenses',
  incomeRootPath: 'income',
}

// True when `path` is exactly `root` or a descendant `root:...`. Anchored on the colon so
// `assets` matches `assets:cash` but not `assetsfoo`.
const under = (path: string, root: string) => path === root || path.startsWith(`${root}:`)

// Resolves an account path to its type by matching the configured roots. Returns null for
// paths under no known root (atypical names) — callers decide the fallback. When more than
// one root could match (e.g. a root that is itself a prefix of another), the longest root
// wins so the most specific classification is chosen.
export function resolveAccountType(path: string, roots: AccountTypeRoots): AccountType | null {
  const candidates: { type: AccountType; root: string }[] = [
    { type: 'asset', root: roots.assetsRootPath },
    { type: 'liability', root: roots.liabilitiesRootPath },
    { type: 'equity', root: roots.equityRootPath },
    { type: 'expense', root: roots.expensesRootPath },
    { type: 'income', root: roots.incomeRootPath },
  ]

  let best: { type: AccountType; root: string } | null = null
  for (const c of candidates) {
    if (!under(path, c.root)) continue
    if (!best || c.root.length > best.root.length) best = c
  }
  return best?.type ?? null
}

/**
 * Everything the resolver needs besides the account itself: the configured roots, and the
 * user's tagged accounts by path so an untagged account can find its nearest tagged ancestor.
 *
 * `tagged` is required, not optional. A caller that loaded only the roots would resolve every
 * child of a tagged parent as if the tag were not there — the bug inheritance exists to fix —
 * so it is a compile error instead. Loaded by `loadAccountTypeContext`; `tagsFrom` builds it
 * from rows a caller already holds.
 */
export type AccountTypeContext = AccountTypeRoots & {
  tagged: ReadonlyMap<string, StoredAccountType>
}

/** The path → type map of accounts that carry a valid override. Invalid values are skipped. */
export function tagsFrom(
  rows: Iterable<{ path: string; type: string | null }>,
): Map<string, StoredAccountType> {
  const tagged = new Map<string, StoredAccountType>()
  for (const { path, type } of rows) if (isStoredAccountType(type)) tagged.set(path, type)
  return tagged
}

/** Where an account's type came from: its own tag, a tagged ancestor, or a configured root. */
export type TypeSource =
  | { type: StoredAccountType; from: 'own' }
  | { type: StoredAccountType; from: 'ancestor'; path: string }
  | { type: AccountType; from: 'root'; path: string }

/**
 * The account's type and where it came from, or null when nothing on the way up says.
 *
 * The account's own `type` column is what counts at its own level, not whatever `tagged`
 * holds for its path — the row in hand is the one being asked about. Pass `type: null` to ask
 * what "Auto" would resolve to, which is how the settings page shows it.
 */
export function explainType(
  account: { path: string; type: string | null },
  ctx: AccountTypeContext,
): TypeSource | null {
  if (isStoredAccountType(account.type)) return { type: account.type, from: 'own' }

  const segments = account.path.split(':')
  for (let depth = segments.length; depth > 0; depth--) {
    const level = segments.slice(0, depth).join(':')
    if (depth < segments.length) {
      const tag = ctx.tagged.get(level)
      if (tag) return { type: tag, from: 'ancestor', path: level }
    }
    const root = rootTypeAt(level, ctx)
    if (root) return { type: root, from: 'root', path: level }
  }
  return null
}

// Which inferable type a configured root at exactly this path stands for, if any.
function rootTypeAt(path: string, roots: AccountTypeRoots): AccountType | null {
  if (path === roots.assetsRootPath) return 'asset'
  if (path === roots.liabilitiesRootPath) return 'liability'
  if (path === roots.equityRootPath) return 'equity'
  if (path === roots.expensesRootPath) return 'expense'
  if (path === roots.incomeRootPath) return 'income'
  return null
}

// The effective hledger type of an account: its own valid override, else its nearest tagged
// ancestor's, else root inference. This is the resolver every consumer (UI, journal export)
// should call so they all agree on one answer. An invalid stored value (shouldn't happen —
// validated on write) counts as no override. Consumers that need the coarse classifier bucket
// run the result through `toClassifierType`.
export function resolveStoredOrInferredType(
  account: { path: string; type: string | null },
  ctx: AccountTypeContext,
): StoredAccountType | null {
  return explainType(account, ctx)?.type ?? null
}
