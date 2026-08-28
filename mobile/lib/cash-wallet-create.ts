/**
 * Create-a-wallet logic for the Cash mode's first-run flow.
 *
 * A wallet is an account tagged with the hledger type `cash`. That tag is
 * override-only — path inference never produces it — so an account created here
 * is invisible to the very screen that made it until the tag lands. Creating and
 * tagging is therefore one operation, not two optional ones; see
 * {@link walletCreateSteps} for the shape the UI reports.
 *
 * Per the epic decision (2026-08-27) a wallet holds exactly one currency and
 * lives at `assets:cash:<code>`. The prefix is fixed and the leaf is the
 * currency, which keeps the path predictable, makes the account self-describing
 * in an hledger export, and matches the per-currency pattern the ledger already
 * uses for Wise. Anyone wanting a different path uses the web app; this flow is
 * deliberately narrow.
 *
 * RN-free so `bun test` covers it without a renderer (Companion convention).
 */
import { isSupportedCurrency } from './currency'

/** Fixed parent for wallets made by this flow. Shown read-only in the preview. */
export const CASH_PARENT = 'assets:cash'

/** Why a currency can't be picked, or null when it can. */
export type WalletBlockReason = 'unsupported' | 'taken'

/**
 * The ledger path for a wallet in `currency`. Lower-cased leaf: paths are
 * case-sensitive strings in the ledger and the rest of the tree is lower-case,
 * so `assets:cash:CAD` would sort and read as a stranger among its siblings.
 */
export function walletPath(currency: string): string {
  return `${CASH_PARENT}:${currency.trim().toLowerCase()}`
}

/**
 * Default display name for a new wallet. The path leaf already carries the
 * code, but the name is what the Wallets tab and the header show, and "Cash
 * (CNY)" reads better than a bare "cny" the moment there is more than one.
 */
export function defaultWalletName(currency: string): string {
  return `Cash (${currency.trim().toUpperCase()})`
}

/**
 * Whether `currency` can have a wallet created for it — and if not, why. A
 * currency that already has one is blocked rather than hidden, so the picker
 * can say "you already have this" instead of silently lacking a tile.
 */
export function blockReasonFor(
  currency: string,
  taken: ReadonlySet<string>,
): WalletBlockReason | null {
  const code = currency.trim().toUpperCase()
  if (!isSupportedCurrency(code)) return 'unsupported'
  if (taken.has(code)) return 'taken'
  return null
}

/** Convenience predicate over {@link blockReasonFor}. */
export function canCreateWallet(currency: string, taken: ReadonlySet<string>): boolean {
  return blockReasonFor(currency, taken) === null
}

/** The body for `createAccount` when making a wallet for `currency`. */
export interface WalletCreateRequest {
  path: string
  name: string
  defaultCurrency: string
}

/**
 * Assemble the create request. Throws on a currency the flow refuses, so a
 * caller that skipped {@link canCreateWallet} fails loudly here rather than
 * writing a malformed or duplicate account into the ledger.
 */
export function walletCreateRequest(
  currency: string,
  taken: ReadonlySet<string>,
): WalletCreateRequest {
  const reason = blockReasonFor(currency, taken)
  if (reason === 'unsupported') throw new Error(`Unsupported currency: ${currency}`)
  if (reason === 'taken') throw new Error(`A ${currency} wallet already exists`)

  const code = currency.trim().toUpperCase()
  return { path: walletPath(code), name: defaultWalletName(code), defaultCurrency: code }
}

/**
 * The two calls that make a wallet, in order. Creating the account is only half
 * the job: an untagged account is an ordinary asset that the Cash mode's strict
 * `resolvedType === 'cash'` filter will not show, so the tag is not optional.
 * Naming the steps lets the UI report *which* one failed — a failed tag leaves a
 * real account behind and must offer a retry rather than a fresh create, or the
 * retry mints a duplicate.
 */
export const walletCreateSteps = ['create', 'tag'] as const
export type WalletCreateStep = (typeof walletCreateSteps)[number]

/**
 * What to tell the user when a step fails, and whether retrying repeats the
 * whole flow or just the tag. A failure after the account exists must resume at
 * the tag; PATCHing type on an already-tagged account is idempotent, so a
 * retry is safe to repeat.
 */
export function walletCreateFailure(step: WalletCreateStep): {
  message: string
  resumeAt: WalletCreateStep
} {
  if (step === 'tag') {
    return {
      message: "Wallet created, but couldn't be marked as cash. Retry to finish.",
      resumeAt: 'tag',
    }
  }
  return { message: "Couldn't create the wallet.", resumeAt: 'create' }
}
