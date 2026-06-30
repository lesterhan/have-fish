// Shared account-type resolver.
//
// An account's TYPE is a permanent property of the account (is it an asset, a liability,
// an expense, …) — distinct from a posting's ROLE, which is the job one leg does inside a
// single transaction (see roles.ts). Type is an input to role classification.
//
// Today the type is INFERRED from the account's path root against the user's configured
// root paths. This is the "C" decision (2026-06-24, single-transaction-view epic): one
// shared resolver now, a stored `accounts.type` override column later (hledger-export
// epic) layered on top as "stored value, else infer" — no caller rework when it lands.
//
// Inference cannot classify atypically-named roots (e.g. `储蓄:中国银行` or `花钱:房租`);
// those resolve to null here and will be unlocked by the future manual-assignment column.

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
export const ACCOUNT_TYPES: readonly AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']

// The seven valid stored-override values — for validating the stored column or API input.
export const STORED_ACCOUNT_TYPES: readonly StoredAccountType[] = [
  'asset', 'cash', 'liability', 'equity', 'income', 'expense', 'conversion',
]

// Type guard for one of the five inferable types.
export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)
}

// Type guard for a stored override value (the full seven-type set).
export function isStoredAccountType(value: unknown): value is StoredAccountType {
  return typeof value === 'string' && (STORED_ACCOUNT_TYPES as readonly string[]).includes(value)
}

// Maps each stored type to its single-letter hledger account-type code, used by the journal
// serializer to emit `account <path>  ; type:<CODE>` directives. Codes per hledger docs:
// A=Asset, C=Cash, L=Liability, E=Equity, R=Revenue(income), X=Expense, V=Conversion.
export const HLEDGER_TYPE_CODE: Record<StoredAccountType, string> = {
  asset: 'A',
  cash: 'C',
  liability: 'L',
  equity: 'E',
  income: 'R',
  expense: 'X',
  conversion: 'V',
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

// Stored-wins-else-infer: the effective hledger type of an account. A valid stored `type`
// override wins (and may be one of the seven, including Cash/Conversion); otherwise fall back
// to path inference (which only ever yields the coarse five). This is the resolver every
// consumer (UI, journal export) should call so they all agree on one answer. An invalid stored
// value (shouldn't happen — validated on write) is ignored in favour of inference. Consumers
// that need the coarse classifier bucket run the result through `toClassifierType`.
export function resolveStoredOrInferredType(
  account: { path: string; type: string | null },
  roots: AccountTypeRoots,
): StoredAccountType | null {
  if (isStoredAccountType(account.type)) return account.type
  return resolveAccountType(account.path, roots)
}
