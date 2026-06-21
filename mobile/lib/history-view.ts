/**
 * View model for the History tab's scannable feed.
 *
 * Kept free of any React Native import so it can be unit-tested under `bun test`
 * (the RN modules don't parse there). `components/HistoryPanel.tsx` renders the
 * rows this produces; the screen owns only layout.
 *
 * Both sections are newest-first already (the API returns them that way); this
 * module reshapes the raw `GroupExpense` / `GroupSettlement` records into the
 * exact fields each row paints, resolving display names and the settlement
 * status badge so the component stays declarative.
 */

import type { GroupExpense, GroupSettlement } from './api'
import { monthDay } from './expense-date'

export interface ExpenseRow {
  id: string
  /** Payer display name (drives the avatar initials + meta line). */
  payer: string
  description: string
  /** `Mon D` label. */
  date: string
  amount: string
  currency: string
  /** Category tag text, uppercased; `null` when uncategorized (tag omitted). */
  category: string | null
}

/** Badge style variant — keeps the color decision out of the component. */
export type SettlementBadge = 'completed' | 'pending'

export interface SettlementRow {
  id: string
  from: string
  to: string
  date: string
  amount: string
  currency: string
  status: SettlementBadge
  /** Uppercase badge label. */
  statusLabel: string
}

export interface HistoryView {
  expenses: ExpenseRow[]
  settlements: SettlementRow[]
  expenseCount: number
  settlementCount: number
}

/** Fallback when a name hasn't been resolved server-side. */
const UNKNOWN = 'Unknown'

function expenseRow(e: GroupExpense): ExpenseRow {
  return {
    id: e.id,
    payer: e.payerName ?? UNKNOWN,
    description: e.description,
    date: monthDay(e.date),
    amount: e.amount,
    currency: e.currency,
    category: e.categoryName ? e.categoryName.toUpperCase() : null,
  }
}

function settlementRow(s: GroupSettlement): SettlementRow {
  const status: SettlementBadge = s.status === 'pending' ? 'pending' : 'completed'
  return {
    id: s.id,
    from: s.fromUserName ?? UNKNOWN,
    to: s.toUserName ?? UNKNOWN,
    date: monthDay(s.date),
    amount: s.amount,
    currency: s.currency,
    status,
    statusLabel: status.toUpperCase(),
  }
}

/** Build the History feed view model from the active group's raw records. */
export function historyView(
  expenses: GroupExpense[],
  settlements: GroupSettlement[],
): HistoryView {
  return {
    expenses: expenses.map(expenseRow),
    settlements: settlements.map(settlementRow),
    expenseCount: expenses.length,
    settlementCount: settlements.length,
  }
}
