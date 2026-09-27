// The legs each member's own ledger gets from Fish Pie: an expense's share, a settlement
// paid, a settlement received. Pure: the expense service and the settlement routes resolve
// the accounts and write these through the ledger service, which checks they balance.
//
// Every leg is in the member's own accounts. The clearing account
// (`assets:receivable:<group>`) is where what the group owes them meets what they owe it.

import type { PostingDraft } from '../ledger/validate'

/**
 * One member's legs for a shared expense.
 *
 * - **The payer, with the account they paid from**: payment −total, the clearing account
 *   +(everyone else's share), their expense +(their share). The clearing leg is left out
 *   when no one else owes anything. This mirrors the import path's structure.
 * - **Anyone else**: expense +share (their share of the spending, the same sign as every
 *   other expense leg), clearing −share (their debt to the payer; the settlement's payer leg
 *   posts +share, which clears it to zero). BUG-005.
 * - **The payer, with no source account**: the legacy two-leg shape, signs intentionally
 *   kept from before BUG-005. Only reachable via PATCH without paymentAccountId (BUG-006),
 *   and removed by the proposals epic.
 */
export function expenseMemberLegs(opts: {
  isPayer: boolean
  paymentAccountId: string | undefined
  sharedAccountId: string
  expenseAccountId: string
  share: string
  totalAmount: string
  currency: string
}): PostingDraft[] {
  const { sharedAccountId, expenseAccountId, share, totalAmount, currency } = opts
  if (opts.isPayer && opts.paymentAccountId) {
    const othersShare = (parseFloat(totalAmount) - parseFloat(share)).toFixed(2)
    return [
      {
        accountId: opts.paymentAccountId,
        amount: (-parseFloat(totalAmount)).toFixed(2),
        currency,
      },
      ...(parseFloat(othersShare) !== 0
        ? [{ accountId: sharedAccountId, amount: othersShare, currency }]
        : []),
      { accountId: expenseAccountId, amount: share, currency },
    ]
  }
  if (!opts.isPayer) {
    return [
      { accountId: expenseAccountId, amount: share, currency },
      { accountId: sharedAccountId, amount: `-${share}`, currency },
    ]
  }
  return [
    { accountId: expenseAccountId, amount: `-${share}`, currency },
    { accountId: sharedAccountId, amount: share, currency },
  ]
}

/** Which end of a settlement a ledger belongs to. */
export type SettlementSide = 'payer' | 'receiver'

const signed = (side: SettlementSide, amount: string) => (side === 'payer' ? amount : `-${amount}`)
const flipped = (side: SettlementSide, amount: string) => (side === 'payer' ? `-${amount}` : amount)

/**
 * One side of a single-currency settlement. The payer's cash leaves (−amount) and their
 * clearing account is credited (+amount); the receiver's cash arrives (+amount) and their
 * clearing account is drained (−amount), which is what clears the debt on both sides.
 */
export function settlementLegs(
  side: SettlementSide,
  accounts: { cash: string; clearing: string },
  amount: string,
  currency: string,
): PostingDraft[] {
  return [
    { accountId: accounts.cash, amount: flipped(side, amount), currency },
    { accountId: accounts.clearing, amount: signed(side, amount), currency },
  ]
}

/**
 * One debt a batch settles: the amount owed in its own currency, and what was actually paid
 * when that was a different currency (null when it was paid as-is).
 */
export type BatchLine = {
  debtAmount: string
  debtCurrency: string
  settled: { amount: string; currency: string } | null
}

/**
 * One side of a batch settlement: several debts, possibly in several currencies, in one
 * combined transaction.
 *
 * - One cash leg per currency actually paid, the lines' amounts summed: a single bank
 *   movement per currency.
 * - One clearing leg per debt, in the debt's currency, so the balance still nets per debt
 *   currency.
 * - A line paid in another currency is bridged through the conversion account (+paid in the
 *   paid currency, −debt in the debt currency), the same shape as a cross-currency transfer
 *   at import, so every currency nets to zero.
 *
 * The receiver's legs are the payer's with every sign flipped. `conversion` must be set when
 * any line was converted; callers refuse the request before this when it isn't.
 */
export function batchSettlementLegs(
  side: SettlementSide,
  accounts: { cash: string; clearing: string; conversion: string | null },
  lines: readonly BatchLine[],
): PostingDraft[] {
  const legs: PostingDraft[] = []

  const cashByCurrency = new Map<string, number>()
  for (const l of lines) {
    const paid = l.settled ?? { amount: l.debtAmount, currency: l.debtCurrency }
    cashByCurrency.set(
      paid.currency,
      (cashByCurrency.get(paid.currency) ?? 0) + parseFloat(paid.amount),
    )
  }
  for (const [currency, total] of cashByCurrency) {
    legs.push({ accountId: accounts.cash, amount: flipped(side, total.toFixed(2)), currency })
  }

  for (const l of lines) {
    legs.push({
      accountId: accounts.clearing,
      amount: signed(side, l.debtAmount),
      currency: l.debtCurrency,
    })
    if (l.settled) {
      if (!accounts.conversion)
        throw new Error('a converted settlement line needs a conversion account')
      legs.push({
        accountId: accounts.conversion,
        amount: signed(side, l.settled.amount),
        currency: l.settled.currency,
      })
      legs.push({
        accountId: accounts.conversion,
        amount: flipped(side, l.debtAmount),
        currency: l.debtCurrency,
      })
    }
  }
  return legs
}
