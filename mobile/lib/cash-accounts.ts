/**
 * Cash-wallet selection and presentation helpers for the Cash mode.
 *
 * A "wallet" is an account the user has explicitly tagged with the hledger type
 * `cash`. That tag is the *only* thing that makes an account a wallet — see
 * `backend/src/postings/account-type.ts`, where `cash` is override-only: path
 * inference can never produce it, so `assets:cash:cad` is an ordinary asset
 * until somebody tags it. Nothing here guesses from the path; a heuristic would
 * quietly disagree with the backend, the journal export, and the web UI.
 *
 * Per the epic decision (2026-08-27) a wallet holds exactly one currency —
 * `assets:cash:cad`, `assets:cash:cny` — matching the per-currency pattern the
 * ledger already uses for Wise. These helpers therefore reduce a wallet's
 * balance list to its single meaningful figure, while still behaving sanely if
 * a multi-currency wallet turns up (created on the web, or predating the rule).
 *
 * RN-free so `bun test` can cover it without a renderer (Companion convention).
 * Amounts are `numeric(12,2)` strings throughout and are never mutated here.
 */
import type { Account, AccountBalance } from './api'

/** Real Unicode minus sign (U+2212), matching `balances-view.ts` and the design. */
export const MINUS = '−'

/** AsyncStorage key for the last-selected wallet — mirrors `LAST_GROUP_KEY`. */
export const LAST_WALLET_KEY = 'havefish_last_wallet'

/**
 * True when the account is a cash wallet. Strictly the resolved hledger type —
 * `resolvedType` is the backend's stored-wins-else-infer answer, so this is one
 * shared verdict rather than a second opinion.
 */
export function isCashAccount(account: { resolvedType?: string | null }): boolean {
  return account.resolvedType === 'cash'
}

/**
 * The wallets in a list of accounts, in a stable display order: by path, so the
 * per-currency siblings of one parent (`assets:cash:cad`, `assets:cash:cny`)
 * group together and the order never jitters between loads.
 */
export function cashAccounts<T extends { resolvedType?: string | null; path: string }>(
  accounts: T[],
): T[] {
  return accounts.filter(isCashAccount).sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Display label for a wallet: its human name when set, else the leaf segment
 * upper-cased when that leaf is the currency code (the per-currency convention
 * makes `assets:cash:cad` read as "CAD", not "cad"), else the leaf as written.
 */
export function walletLabel(account: { name?: string | null; path: string }): string {
  const name = account.name?.trim()
  if (name) return name
  const leaf = account.path.split(':').pop()?.trim() ?? account.path
  return /^[a-z]{3}$/.test(leaf) ? leaf.toUpperCase() : leaf
}

/**
 * The currency a wallet holds. Prefers the account's `defaultCurrency`; falls
 * back to a three-letter leaf segment (the per-currency path convention), so a
 * wallet created on the web without a default currency still reads correctly.
 * Null when neither source can say.
 */
export function walletCurrency(account: {
  defaultCurrency?: string | null
  path: string
}): string | null {
  const explicit = account.defaultCurrency?.trim()
  if (explicit) return explicit.toUpperCase()
  const leaf = account.path.split(':').pop()?.trim() ?? ''
  return /^[a-zA-Z]{3}$/.test(leaf) ? leaf.toUpperCase() : null
}

/**
 * A wallet's balance in one currency, as a `numeric(12,2)` string. Returns
 * '0.00' when the account has no postings in it — a wallet that has never been
 * spent from holds zero, which is a real answer, not a missing one.
 */
export function balanceIn(balances: { currency: string; amount: string }[], currency: string): string {
  return balances.find((b) => b.currency === currency)?.amount ?? '0.00'
}

/**
 * Format a signed amount for display: real minus sign, two decimals, thousands
 * separators. A negative cash balance is not impossible (an unrecorded top-up,
 * a mis-entered spend) and must render as the warning it is rather than being
 * clamped to zero.
 */
export function formatAmount(amount: string): string {
  const n = parseFloat(amount)
  if (!Number.isFinite(n)) return amount
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `${MINUS}${abs}` : abs
}

/** A wallet paired with the balance figure the Wallets tab shows for it. */
export interface WalletView {
  id: string
  path: string
  label: string
  /** The wallet's currency, or null when it can't be determined. */
  currency: string | null
  /** Signed balance string in `currency`; '0.00' when there are no postings. */
  amount: string
  /**
   * Extra currencies present on the account beyond its own. Empty under the
   * one-wallet-per-currency rule; non-empty means the ledger disagrees with
   * that rule and the UI should surface it rather than silently hide money.
   */
  extra: { currency: string; amount: string }[]
}

/**
 * Build the Wallets tab's view model by joining tagged accounts to their
 * balances. Accounts with no balance row (never posted to) still appear at
 * zero — a freshly created wallet must be visible and selectable.
 */
export function walletViews(balances: AccountBalance[]): WalletView[] {
  return cashAccounts(balances).map((account) => {
    const currency = walletCurrency(account)
    const rows = account.balances ?? []
    return {
      id: account.id,
      path: account.path,
      label: walletLabel(account),
      currency,
      amount: currency ? balanceIn(rows, currency) : (rows[0]?.amount ?? '0.00'),
      extra: currency ? rows.filter((b) => b.currency !== currency) : rows.slice(1),
    }
  })
}

/**
 * Resolve which wallet should be active: the stored one when it still exists,
 * else the first available, else null. Mirrors `resolveActiveGroupId` — a
 * remembered id that has since been deleted (or belongs to another login) must
 * degrade to a sensible default rather than leaving the tab blank.
 */
export function resolveActiveWalletId(
  stored: string | null | undefined,
  wallets: { id: string }[],
): string | null {
  if (stored && wallets.some((w) => w.id === stored)) return stored
  return wallets[0]?.id ?? null
}

/**
 * Currencies that already have a wallet — the create-a-wallet flow disables
 * these so a second `assets:cash:cny` can't be minted (Story 3).
 */
export function takenCurrencies(accounts: (Account | AccountBalance)[]): Set<string> {
  const taken = new Set<string>()
  for (const account of cashAccounts(accounts)) {
    const currency = walletCurrency(account)
    if (currency) taken.add(currency)
  }
  return taken
}
