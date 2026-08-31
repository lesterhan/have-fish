/**
 * Cash history view model — the feed for one wallet.
 *
 * Turns the raw transaction list into rows a person can reconcile against the
 * notes in their pocket: what the wallet moved, what it moved against, and what
 * the balance was after each one.
 *
 * Three kinds of transaction reach this feed and each has to read as itself:
 *
 * - **A cash purchase**, one or many expense legs. A split shows as one row
 *   naming its categories, not N rows — it was one payment.
 * - **A top-up**, where the wallet gains and some other account loses. The
 *   cross-currency form carries conversion legs that are pure plumbing and are
 *   never the interesting counterparty.
 * - **A Fish Pie expense paid in cash.** Funding a group expense from a wallet
 *   is supported and puts a 3-posting group transaction in this feed. Shown raw
 *   it reads as an anonymous three-leg list, so it gets the group's name and
 *   "your share" framing instead.
 *
 * Arithmetic is in integer cents, shared with `cash-entry.ts`.
 *
 * RN-free so `bun test` covers it without a renderer (Companion convention).
 */
import type { Transaction } from './api'
import { fromCents, toCents } from './cash-entry'

/** One transaction as the wallet feed shows it. */
export interface CashHistoryRow {
  id: string
  /** ISO date, for grouping into days. */
  date: string
  description: string
  /** Signed movement of the wallet, in its own currency. */
  amount: string
  currency: string
  /**
   * What the wallet moved against, leaf-named: expense categories on a spend,
   * the funding account on a top-up. Plumbing legs are excluded.
   */
  counterparties: string[]
  /** The group's name when this is a Fish Pie expense paid in cash. */
  groupName: string | null
  /** The user's own share of a group expense — what they actually consumed. */
  share: string | null
  /** Wallet balance immediately after this transaction. */
  balanceAfter: string
}

/** The last segment of an account path, which is what a person calls it. */
export function leafOf(path: string): string {
  const leaf = path.split(':').pop()?.trim()
  return leaf && leaf.length > 0 ? leaf : path
}

/**
 * The wallet's own net movement in a transaction, in cents. Sums every leg
 * touching the wallet — a transaction can, legitimately, touch it more than
 * once.
 */
export function walletDeltaCents(tx: Transaction, walletId: string): number {
  return tx.postings
    .filter((p) => p.accountId === walletId)
    .reduce((sum, p) => sum + (toCents(p.amount) ?? 0), 0)
}

/**
 * The legs worth naming: everything except the wallet itself and the mechanical
 * plumbing. Conversion legs exist to make two currencies balance and say
 * nothing about what happened; a fee is real but is not what the money was for.
 *
 * Fish Pie share legs (the receivable) are excluded too — the group's name
 * carries that meaning better than the clearing account's path does.
 */
export function counterpartiesOf(tx: Transaction, walletId: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const posting of tx.postings) {
    if (posting.accountId === walletId) continue
    if (posting.role === 'conversion' || posting.role === 'share') continue
    const leaf = leafOf(posting.accountPath)
    if (seen.has(leaf)) continue
    seen.add(leaf)
    out.push(leaf)
  }
  return out
}

/**
 * The user's own share of a Fish Pie expense: the expense leg, which is what
 * they consumed, as opposed to the full amount they fronted. Null for anything
 * that isn't a group transaction.
 */
export function shareOf(tx: Transaction): string | null {
  if (!tx.groupName) return null
  const expenseLegs = tx.postings.filter((p) => p.role === 'subject')
  if (expenseLegs.length === 0) return null
  return fromCents(expenseLegs.reduce((sum, p) => sum + (toCents(p.amount) ?? 0), 0))
}

/**
 * Build the feed for one wallet.
 *
 * `transactions` arrives newest-first (the API's order) and `currentBalance` is
 * the wallet's balance now, so each row's running balance is the current one
 * with the later movements unwound. Deriving it from the live balance rather
 * than accumulating from zero means the figures agree with the Wallets tab even
 * when the feed is partial.
 */
export function cashHistoryRows(args: {
  transactions: Transaction[]
  walletId: string
  currency: string
  currentBalance: string
}): CashHistoryRow[] {
  const { transactions, walletId, currency, currentBalance } = args

  let running = toCents(currentBalance) ?? 0
  const rows: CashHistoryRow[] = []

  for (const tx of transactions) {
    const delta = walletDeltaCents(tx, walletId)
    // Transactions that don't touch the wallet can appear when the caller
    // filtered by something broader; they have no place in a wallet's feed.
    if (delta === 0 && !tx.postings.some((p) => p.accountId === walletId)) continue

    rows.push({
      id: tx.id,
      date: tx.date,
      description: tx.description?.trim() || (tx.groupName ? 'Group expense' : 'Cash'),
      amount: fromCents(delta),
      currency,
      counterparties: counterpartiesOf(tx, walletId),
      groupName: tx.groupName ?? null,
      share: shareOf(tx),
      balanceAfter: fromCents(running),
    })
    // Step back past this transaction to get the balance before it, which is
    // the balance after the next (older) one.
    running -= delta
  }

  return rows
}

/** A day's worth of rows, for a sectioned feed. */
export interface CashHistoryDay {
  /** ISO date (YYYY-MM-DD). */
  date: string
  rows: CashHistoryRow[]
}

/**
 * Group rows into days, preserving the newest-first order within and between
 * days. Dates arrive as timestamps; only the calendar day matters here.
 */
export function groupByDay(rows: CashHistoryRow[]): CashHistoryDay[] {
  const days: CashHistoryDay[] = []
  for (const row of rows) {
    const date = row.date.slice(0, 10)
    const last = days[days.length - 1]
    if (last && last.date === date) last.rows.push(row)
    else days.push({ date, rows: [row] })
  }
  return days
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** Day heading: "Today" / "Yesterday" / "Mon 14 Jul". */
export function dayHeading(date: string, now: Date = new Date()): string {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const today = iso(now)
  if (date === today) return 'Today'

  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (date === iso(yesterday)) return 'Yesterday'

  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  // Assembled by hand rather than via toLocaleDateString: its punctuation
  // ("Thu, 20 Aug" vs "Thu 20 Aug") varies with the device's ICU data, and a
  // heading that shifts between builds is a needless inconsistency.
  const weekday = WEEKDAYS[parsed.getUTCDay()]
  const month = MONTHS[parsed.getUTCMonth()]
  return `${weekday} ${parsed.getUTCDate()} ${month}`
}
