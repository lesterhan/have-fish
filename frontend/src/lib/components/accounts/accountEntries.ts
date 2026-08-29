/**
 * What a transaction looks like from one account's point of view.
 *
 * The spending list asks "what did I buy" and answers with the expense leg. A row on the
 * Accounts page is asking something narrower — "what moved in *this* account" — so the
 * amount is the sum of this account's own postings, signed as the account saw it, and the
 * counterparty is whatever the other side of the entry was. Reusing `SpendingTxnRow` here
 * would show the expense leg of a transfer between two of your own accounts, which is a
 * different fact than the one the row is asking about.
 */

import { toCents } from '../../money'
import { isUnderRoot, shortPath } from './accountPaths'
import type { Posting, Transaction } from '../../api'

/** How many entries the drawer shows. Enough to recognise the account, short enough to scan. */
export const RECENT_ENTRIES = 5

export interface EntryLine {
  id: string
  /** `YYYY-MM-DD`, already trimmed of any time part. */
  date: string
  description: string
  /** This account's own movement, in cents. Negative means money left. */
  cents: number
  currency: string
  /** True when this account's postings span more than one currency — cents is then partial. */
  mixedCurrency: boolean
  /** The other side: one path, "split" for several, or null when there is no other side. */
  counterparty: string | null
}

/**
 * Which postings belong to the row.
 *
 * By id for a real account, by path prefix for a category — a tree row stands for its whole
 * subtree, and a virtual segment has no id to match on at all.
 */
export type EntryMatch =
  { kind: 'account'; accountId: string } | { kind: 'subtree'; path: string }

function matches(posting: Posting, match: EntryMatch): boolean {
  return match.kind === 'account'
    ? posting.accountId === match.accountId
    : isUnderRoot(posting.accountPath, match.path)
}

/** `2026-08-27T00:00:00.000Z` → `2026-08-27`. Dates are stored as dates; some carry a time. */
function dayOf(date: string): string {
  return date.slice(0, 10)
}

function counterpartyOf(
  others: readonly Posting[],
  root: string,
): string | null {
  const paths = [...new Set(others.map((p) => p.accountPath))]
  if (paths.length === 0) return null
  if (paths.length > 1) return 'split'
  return shortPath(paths[0]!, root)
}

/**
 * One line per transaction, newest first, capped.
 *
 * A transaction that does not touch the account is dropped rather than rendered blank — the
 * path-prefix filter is applied server-side, but the id filter is not, and a caller may hand
 * us a wider list than it needs.
 */
export function entryLines(
  transactions: readonly Transaction[],
  match: EntryMatch,
  options: { root?: string; limit?: number } = {},
): EntryLine[] {
  const { root = '', limit = RECENT_ENTRIES } = options
  const lines: EntryLine[] = []

  for (const tx of transactions) {
    const mine = tx.postings.filter((p) => matches(p, match))
    if (mine.length === 0) continue

    const currencies = [...new Set(mine.map((p) => p.currency))]
    // A single account holding two currencies in one entry is a conversion; summing across
    // them would invent a number, so the line shows the first currency and says it is partial.
    const currency = currencies[0]!
    const cents = mine
      .filter((p) => p.currency === currency)
      .reduce((sum, p) => sum + (toCents(p.amount) ?? 0), 0)

    lines.push({
      id: tx.id,
      date: dayOf(tx.date),
      description: tx.description?.trim() || '—',
      cents,
      currency,
      mixedCurrency: currencies.length > 1,
      counterparty: counterpartyOf(
        tx.postings.filter((p) => !matches(p, match)),
        root,
      ),
    })
  }

  // The API already orders by date descending, but a same-day group has no guaranteed order,
  // so sorting here keeps the drawer stable rather than relying on that.
  lines.sort((a, b) => b.date.localeCompare(a.date))
  return lines.slice(0, limit)
}
