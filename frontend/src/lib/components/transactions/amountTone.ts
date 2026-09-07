import type { StoredAccountType } from '$lib/api'

/**
 * Which colour an amount carries in a ledger.
 *
 * A ledger colours amounts *by exception* rather than by sign. On a credit card every row
 * is an expense, so the usual negative-is-red convention paints the whole column red and
 * stops carrying information — twenty-two red numbers read as twenty-two errors rather than
 * as ordinary spending. Expenses are the default here and take the ordinary text colour;
 * only money coming back is tinted. Colour marks the minority sign (DESIGN.md §5).
 *
 * The decision keys off the **counterpart's** type rather than the row's `isTransfer`
 * flag. `isTransfer` asks whether the destination posting is an expense account, and on an
 * asset or liability page the destination of any money-in row *is* the account you are
 * looking at — so it reports every refund as a transfer and the tint would never fire.
 * The question that actually matters is where the money came from: outside your books
 * (income, or an expense reversing itself) or another account of your own.
 *
 *  - `positive` — money arriving from outside your own accounts: income, or a refund
 *    reversing a spend.
 *  - `transfer` — the counterpart is another account of yours, so direction, not sign, is
 *    the story. The colour comes from MoneyDisplay's flow classes
 *    (`--color-transfer-in` / `--color-transfer-out`), which stay untouched: money moving
 *    between your own accounts is not a gain and must never read as green.
 *  - `neutral` — everything else, including an ordinary spend and an unparseable amount.
 *
 * This is the primitive. `ledger.ts` resolves which posting to ask about on each surface —
 * the account you are viewing, or the own-money side of a row on the global list — so both
 * ledgers apply one rule rather than two. The spending page keeps the signed convention
 * documented in CLAUDE.md: there every figure is a spend by construction, so there is no
 * minority sign for colour to mark.
 */
export type AmountTone = 'positive' | 'transfer' | 'neutral'

/** Account types that hold your own money, as opposed to describing where it went. */
export const OWN_MONEY: ReadonlySet<string> = new Set([
  'asset',
  'liability',
  'equity',
  'cash',
  'conversion',
])

export function amountTone(
  amount: string,
  counterpartType: StoredAccountType | null | undefined,
): AmountTone {
  if (counterpartType && OWN_MONEY.has(counterpartType)) return 'transfer'

  const n = parseFloat(amount)
  if (!Number.isFinite(n)) return 'neutral'
  return n > 0 ? 'positive' : 'neutral'
}
