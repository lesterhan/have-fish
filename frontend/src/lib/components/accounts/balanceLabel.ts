import type { StoredAccountType } from '$lib/api'

/**
 * The label and rendered figure for an account balance.
 *
 * A credit card that owes 3,759 is not an error, so the account header does not paint it
 * red or lead with a minus sign — colour is an alarm, and this alarm is never going off.
 * The direction moves into the label as a word instead, and the figure is shown as a
 * magnitude. Only liability accounts get that treatment; everywhere else the signed
 * rendering is the honest one.
 *
 * `resolvedType` is the effective type (stored override, else path inference). It is null
 * for an atypical root with no override, which falls through to the neutral BALANCE case.
 */
export type BalanceLabel = {
  /** Uppercase label above the figure, e.g. "OWING · CAD". */
  label: string
  /** The figure to render, already signed or unsigned as the label requires. */
  display: string
  /** True when the label carries the direction and the figure dropped its sign. */
  signInLabel: boolean
}

function format(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function balanceLabel(
  resolvedType: StoredAccountType | null | undefined,
  amount: string,
  currency: string,
): BalanceLabel {
  const n = parseFloat(amount)
  const cur = currency.toUpperCase()

  // An unparseable amount is passed through untouched rather than rendered as NaN.
  if (!Number.isFinite(n)) {
    return { label: `BALANCE · ${cur}`, display: amount, signInLabel: false }
  }

  if (resolvedType === 'liability' && n !== 0) {
    // A liability in credit is the overpaid card — "OWING −412.08" would be nonsense.
    const label = n < 0 ? 'OWING' : 'IN CREDIT'
    return {
      label: `${label} · ${cur}`,
      display: format(Math.abs(n)),
      signInLabel: true,
    }
  }

  return {
    label: `BALANCE · ${cur}`,
    display: `${n < 0 ? '−' : ''}${format(Math.abs(n))}`,
    signInLabel: false,
  }
}
