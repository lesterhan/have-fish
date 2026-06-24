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

// Our subset of hledger's account types. We don't yet distinguish Cash (a subset of Asset)
// or Conversion (a subset of Equity) — equity:conversion resolves to `equity` and is
// identified as a conversion *leg* by the role classifier, not by a distinct type.
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

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
