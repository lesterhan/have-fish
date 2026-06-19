/**
 * Pure, RN-free selectors for the Balances tab's settle action and the batch
 * sheet's guards. Kept testable under `bun test` (no renderer); the sheet
 * component is the thin shell over these + the `fish-pie-settle` helpers.
 */
import type { CurrencyBalance, GroupSettlement } from './api'
import { isConverted, owedDebts, type SettleLine } from './fish-pie-settle'

/**
 * What the single balances-tab button should do for the current user:
 * - `settle` — they owe someone; open the batch sheet.
 * - `pending` — they have an outgoing batch awaiting the receiver's confirm;
 *   show a disabled "Recorded — awaiting {receiverName}" badge (don't let them
 *   pay twice — the balance hasn't zeroed yet).
 * - `waiting` — they're only owed; show a disabled "Waiting for {payerName}".
 * - `none` — nothing outstanding (the card shows the 🎉 state instead).
 */
export type SettleAction =
  | { kind: 'settle' }
  | { kind: 'pending'; receiverName: string }
  | { kind: 'waiting'; payerName: string }
  | { kind: 'none' }

/** Active pending settlements the current user is the payer of. */
export function pendingOutgoing(
  settlements: GroupSettlement[],
  myUserId: string,
): GroupSettlement[] {
  return settlements.filter(
    (s) => s.status === 'pending' && s.fromUserId === myUserId && s.deletedAt == null,
  )
}

export function settleAction(
  balances: CurrencyBalance[],
  settlements: GroupSettlement[],
  myUserId: string,
): SettleAction {
  // A pending outgoing batch wins: the balance still shows the debt until the
  // receiver confirms, so we must not offer "Settle up" again.
  const pending = pendingOutgoing(settlements, myUserId)
  if (pending.length > 0) {
    return { kind: 'pending', receiverName: pending[0].toUserName ?? 'them' }
  }

  if (owedDebts(balances, myUserId).length > 0) return { kind: 'settle' }

  // Not owing anything — are we owed? Surface who we're waiting on.
  for (const cb of balances) {
    for (const t of cb.transfers) {
      if (t.toUserId === myUserId) return { kind: 'waiting', payerName: t.fromUserName ?? 'them' }
    }
  }

  return { kind: 'none' }
}

/**
 * True when the batch needs the payer's `defaultConversionAccountId` but it's
 * unset — at least one included line is actually converting. The sheet blocks
 * submit and points the user to the web app (money legs can't be silent).
 */
export function needsConversionAccount(
  lines: SettleLine[],
  targetCurrency: string,
  defaultConversionAccountId: string | null,
): boolean {
  if (defaultConversionAccountId) return false
  return lines.some((l) => l.include && isConverted(l, targetCurrency))
}
