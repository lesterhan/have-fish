// Pure logic for the batch settle-up flow. The modal is a thin shell over these
// helpers so the payload-building rules can be unit-tested without a DOM.

import type { BatchSettlementLine, CurrencyBalance } from './api'

// A debt the current user owes (they are the debtor / fromUser in a transfer).
export type OwedDebt = {
  toUserId: string
  toUserName: string | null
  amount: string
  currency: string
}

// Editable per-line state in the batch settle modal.
export type SettleLine = {
  toUserId: string
  toUserName: string | null
  debtAmount: string
  debtCurrency: string
  include: boolean
  // Pay this line in the target currency instead of its own (cross-currency).
  convert: boolean
  // Cash paid when converting — editable, prefilled from the FX rate.
  settledAmount: string
  fxRate: string | null
  asOfDate: string | null
}

// Every debt the current user owes, flattened across the per-currency balances.
export function owedDebts(balances: CurrencyBalance[], currentUserId: string): OwedDebt[] {
  const out: OwedDebt[] = []
  for (const cb of balances) {
    for (const t of cb.transfers) {
      if (t.fromUserId === currentUserId) {
        out.push({ toUserId: t.toUserId, toUserName: t.toUserName, amount: t.amount, currency: t.currency })
      }
    }
  }
  return out
}

// Initial line state: include everything; convert lines whose currency differs from
// the target (one-click consolidation), leave same-currency lines native.
export function initLines(debts: OwedDebt[], targetCurrency: string): SettleLine[] {
  return debts.map((d) => ({
    toUserId: d.toUserId,
    toUserName: d.toUserName,
    debtAmount: d.amount,
    debtCurrency: d.currency,
    include: true,
    convert: d.currency !== targetCurrency,
    settledAmount: '',
    fxRate: null,
    asOfDate: null,
  }))
}

// A line is actually converted only when the user asked to convert AND the currencies
// differ. (Toggling convert on a same-currency line is a no-op.)
export function isConverted(line: SettleLine, targetCurrency: string): boolean {
  return line.convert && line.debtCurrency !== targetCurrency
}

// Convert a debt amount at a rate, rounded to 2dp. Returns '' when the rate is missing.
export function convertedAmount(debtAmount: string, rate: string | null): string {
  if (!rate) return ''
  const v = parseFloat(debtAmount) * parseFloat(rate)
  if (!Number.isFinite(v)) return ''
  return v.toFixed(2)
}

// True when there is at least one included line and every included converted line has
// a positive settled amount — i.e. the batch is safe to submit.
export function linesReady(lines: SettleLine[], targetCurrency: string): boolean {
  const included = lines.filter((l) => l.include)
  if (included.length === 0) return false
  return included.every((l) => (isConverted(l, targetCurrency) ? parseFloat(l.settledAmount) > 0 : true))
}

// Build the create-batch payload from the modal's line state.
// Native line ⇒ settled* mirror the debt. Converted line ⇒ pay settledAmount of the
// target currency at fxRate. Excluded lines are dropped (partial batch).
export function buildBatchLines(lines: SettleLine[], targetCurrency: string): BatchSettlementLine[] {
  const out: BatchSettlementLine[] = []
  for (const l of lines) {
    if (!l.include) continue
    if (isConverted(l, targetCurrency)) {
      out.push({
        toUserId: l.toUserId,
        debtAmount: l.debtAmount,
        debtCurrency: l.debtCurrency,
        settledAmount: l.settledAmount,
        settledCurrency: targetCurrency,
        fxRate: l.fxRate ?? undefined,
      })
    } else {
      out.push({
        toUserId: l.toUserId,
        debtAmount: l.debtAmount,
        debtCurrency: l.debtCurrency,
        settledAmount: l.debtAmount,
        settledCurrency: l.debtCurrency,
      })
    }
  }
  return out
}
