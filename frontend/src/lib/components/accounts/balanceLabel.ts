import type { StoredAccountType } from '$lib/api'
// Relative, not `$lib`: this module is unit-tested directly. See lib-imports.test.ts.
import { formatCents, formatCentsAbs, toCents } from '../../money'

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

export function balanceLabel(
  resolvedType: StoredAccountType | null | undefined,
  amount: string,
  currency: string,
): BalanceLabel {
  const cents = toCents(amount)
  const cur = currency.toUpperCase()

  // An unparseable amount is passed through untouched rather than rendered as NaN.
  if (cents === null) {
    return { label: `BALANCE · ${cur}`, display: amount, signInLabel: false }
  }

  if (resolvedType === 'liability' && cents !== 0) {
    // A liability in credit is the overpaid card — "OWING −412.08" would be nonsense.
    const label = cents < 0 ? 'OWING' : 'IN CREDIT'
    return {
      label: `${label} · ${cur}`,
      display: formatCentsAbs(cents),
      signInLabel: true,
    }
  }

  return {
    label: `BALANCE · ${cur}`,
    display: formatCents(cents),
    signInLabel: false,
  }
}
