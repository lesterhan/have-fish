/**
 * Top-ups and withdrawals — moving money *into* a cash wallet.
 *
 * Two shapes, decided by whether the currencies match:
 *
 * **Same currency** (bank → wallet, an ordinary ATM withdrawal at home):
 * ```
 *   assets:chequing   −200.00 CAD
 *   assets:cash:cad   +200.00 CAD
 * ```
 *
 * **Cross currency** (a card at a foreign ATM, or an exchange counter): the
 * transaction spans two currencies, which cannot balance against each other
 * directly. It is bridged through the user's conversion account, the same
 * 5-posting shape the Currency Transfers epic established for Wise:
 * ```
 *   assets:chequing     −200.00 CAD   what left the account
 *   expenses:fees:atm     +3.00 CAD   the fee, if there was one
 *   equity:conversion   +197.00 CAD   ─┐ the bridge: each currency
 *   equity:conversion  −1000.00 CNY   ─┘ balances to zero on its own
 *   assets:cash:cny    +1000.00 CNY   what you actually got
 * ```
 * The bridge needs `userSettings.defaultConversionAccountId`. Without it there
 * is no honest way to write the transaction, so the flow says so rather than
 * inventing an account.
 *
 * Arithmetic is in integer cents throughout, shared with `cash-entry.ts` —
 * see the note there on why floats are not an option for money.
 *
 * RN-free so `bun test` covers it without a renderer (Companion convention).
 */
import type { PostingInput } from './api'
import { fromCents, toCents } from './cash-entry'

export interface TopUpDraft {
  sourceAccountId: string | null
  sourceCurrency: string
  /** Total that left the source account, fee included. */
  sourceAmount: string
  walletAccountId: string | null
  walletCurrency: string
  /** What actually landed in the wallet. */
  walletAmount: string
  /** Required only when the currencies differ. */
  conversionAccountId?: string | null
  /** Optional fee, always expressed in the source currency. */
  feeAccountId?: string | null
  feeAmount?: string
}

/** True when this movement crosses currencies and needs the bridge. */
export function isCrossCurrency(draft: {
  sourceCurrency: string
  walletCurrency: string
}): boolean {
  return draft.sourceCurrency !== '' && draft.sourceCurrency !== draft.walletCurrency
}

/** Why the top-up can't be saved yet, or null when it can. */
export type TopUpBlocker =
  | 'no-wallet'
  | 'no-source'
  | 'no-amount'
  | 'no-received'
  | 'no-conversion-account'
  | 'fee-exceeds-amount'
  | 'unbalanced'

/**
 * The first thing standing in the way, ordered the way the sheet is filled in.
 */
export function topUpBlocker(draft: TopUpDraft): TopUpBlocker | null {
  if (!draft.walletAccountId) return 'no-wallet'
  if (!draft.sourceAccountId) return 'no-source'

  const sourceCents = toCents(draft.sourceAmount)
  if (sourceCents === null || sourceCents <= 0) return 'no-amount'

  const feeCents = draft.feeAmount ? (toCents(draft.feeAmount) ?? 0) : 0
  if (feeCents >= sourceCents) return 'fee-exceeds-amount'

  const cross = isCrossCurrency(draft)

  if (cross) {
    const walletCents = toCents(draft.walletAmount)
    if (walletCents === null || walletCents <= 0) return 'no-received'
    // Nothing can bridge the two currencies without it, and guessing an account
    // would write a transaction the user never agreed to.
    if (!draft.conversionAccountId) return 'no-conversion-account'
    return null
  }

  // Same currency: what left the source is the fee plus what arrived, so the
  // received amount is implied rather than entered.
  return null
}

export function canSubmitTopUp(draft: TopUpDraft): boolean {
  return topUpBlocker(draft) === null
}

/** Copy for the hint under the save button. */
export function topUpBlockerMessage(blocker: TopUpBlocker): string {
  switch (blocker) {
    case 'no-wallet':
      return 'Pick a wallet to top up'
    case 'no-source':
      return 'Pick where the money came from'
    case 'no-amount':
      return 'Enter how much left the account'
    case 'no-received':
      return 'Enter how much you received'
    case 'no-conversion-account':
      return 'Set a conversion account on the web app to record an exchange'
    case 'fee-exceeds-amount':
      return 'The fee is larger than the amount'
    case 'unbalanced':
      return "The amounts don't balance"
  }
}

/**
 * What arrives in the wallet on a same-currency top-up: everything that left
 * the source, less any fee. Entering it separately would only be a chance to
 * contradict yourself.
 */
export function impliedReceived(sourceAmount: string, feeAmount?: string): string {
  const source = toCents(sourceAmount) ?? 0
  const fee = feeAmount ? (toCents(feeAmount) ?? 0) : 0
  return fromCents(Math.max(0, source - fee))
}

/**
 * The all-in exchange rate: wallet currency received per unit of source
 * currency spent, fee included. That is the number worth checking against the
 * board at the counter — a quoted rate with the fee excluded flatters itself.
 *
 * Null when either side is missing or zero.
 */
export function effectiveRate(sourceAmount: string, walletAmount: string): number | null {
  const source = toCents(sourceAmount)
  const wallet = toCents(walletAmount)
  if (source === null || wallet === null || source <= 0 || wallet <= 0) return null
  return wallet / source
}

/** The rate formatted for display, e.g. "1 CAD = 5.0000 CNY". */
export function formatRate(
  sourceCurrency: string,
  walletCurrency: string,
  rate: number | null,
): string | null {
  if (rate === null) return null
  return `1 ${sourceCurrency} = ${rate.toFixed(4)} ${walletCurrency}`
}

/**
 * Build the postings for a top-up. Throws on anything {@link topUpBlocker}
 * would have caught, so a caller that skipped the check fails loudly here
 * rather than sending the backend an unbalanced transaction.
 */
export function buildTopUpPostings(draft: TopUpDraft): PostingInput[] {
  const blocker = topUpBlocker(draft)
  if (blocker) throw new Error(topUpBlockerMessage(blocker))

  const sourceCents = toCents(draft.sourceAmount)!
  const feeCents = draft.feeAmount ? (toCents(draft.feeAmount) ?? 0) : 0
  const hasFee = feeCents > 0 && !!draft.feeAccountId

  // A fee amount with nowhere to book it would silently vanish from the
  // transaction and unbalance it, so refuse rather than drop it.
  if (feeCents > 0 && !draft.feeAccountId) {
    throw new Error('Pick an account for the fee')
  }

  const postings: PostingInput[] = [
    {
      accountId: draft.sourceAccountId!,
      amount: fromCents(-sourceCents),
      currency: draft.sourceCurrency,
    },
  ]

  if (hasFee) {
    postings.push({
      accountId: draft.feeAccountId!,
      amount: fromCents(feeCents),
      currency: draft.sourceCurrency,
    })
  }

  if (!isCrossCurrency(draft)) {
    postings.push({
      accountId: draft.walletAccountId!,
      amount: fromCents(sourceCents - feeCents),
      currency: draft.walletCurrency,
    })
    return postings
  }

  // Cross-currency: bridge through the conversion account so each currency
  // balances to zero on its own, which is what the backend checks.
  const walletCents = toCents(draft.walletAmount)!
  postings.push(
    {
      accountId: draft.conversionAccountId!,
      amount: fromCents(sourceCents - feeCents),
      currency: draft.sourceCurrency,
    },
    {
      accountId: draft.conversionAccountId!,
      amount: fromCents(-walletCents),
      currency: draft.walletCurrency,
    },
    {
      accountId: draft.walletAccountId!,
      amount: fromCents(walletCents),
      currency: draft.walletCurrency,
    },
  )
  return postings
}

/**
 * Per-currency sums of a posting list, in cents. Every entry must be zero for
 * the backend to accept the transaction; exported so callers and tests can
 * assert the invariant directly rather than inferring it.
 */
export function currencySums(postings: PostingInput[]): Record<string, number> {
  const sums: Record<string, number> = {}
  for (const posting of postings) {
    sums[posting.currency] = (sums[posting.currency] ?? 0) + (toCents(posting.amount) ?? 0)
  }
  return sums
}
