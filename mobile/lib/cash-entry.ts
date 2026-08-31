/**
 * Cash spend entry — the split model and posting assembly for the Spend tab.
 *
 * One physical purchase is often several ledger categories: a 180.00 shop run
 * spanning food, household, and electronics. The backend has always accepted N
 * postings; this is the first place in the app that produces them.
 *
 * ## The split model
 *
 * The hero amount is the transaction total. Beneath it sits a list of rows, each
 * an (expense account, amount) pair:
 *
 * - **One row** is the ordinary case and carries the whole total implicitly —
 *   {@link syncSingleRow} keeps it in step with the hero, so a plain purchase
 *   needs no amount typing beyond the hero itself.
 * - **Two or more rows** are explicit. Each carries its own amount and the
 *   unallocated remainder is shown until it reaches zero, which is also when
 *   submitting becomes possible.
 *
 * ## Money arithmetic
 *
 * All arithmetic is in integer **cents**. Amounts are `numeric(12,2)` strings by
 * convention, and summing them as floats drifts: `0.1 + 0.2 !== 0.3`, so a split
 * that looks exact on screen could fail the backend's balance check, or — worse
 * — pass it while being a cent out. Parsing happens once, at the edge.
 *
 * RN-free so `bun test` covers it without a renderer (Companion convention).
 */
import type { PostingInput } from './api'

/** One (expense account, amount) pair in the split editor. */
export interface SplitRow {
  /** Stable key for React and for row removal — not sent anywhere. */
  id: string
  /** Chosen expense account, or null while the row is still being filled in. */
  accountId: string | null
  /** Raw typed amount string, same convention as the hero. */
  amount: string
}

/** Amount string → integer cents. Null when it isn't a finite number. */
export function toCents(amount: string): number | null {
  const n = parseFloat(amount)
  if (!Number.isFinite(n)) return null
  // Round rather than truncate. Multiplying by 100 lands just under the integer
  // for many ordinary amounts — 8.87 * 100 is 886.9999… — so truncating would
  // silently bill a cent less than the user typed.
  return Math.round(n * 100)
}

/** Integer cents → a `numeric(12,2)` amount string. */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Sum of the rows' amounts, in cents. Rows with no usable amount count as 0. */
export function rowsTotalCents(rows: SplitRow[]): number {
  return rows.reduce((sum, row) => sum + (toCents(row.amount) ?? 0), 0)
}

/**
 * Unallocated cents: the hero total minus what the rows account for. Positive
 * means there is still money to assign; negative means the rows overshoot.
 */
export function remainderCents(total: string, rows: SplitRow[]): number {
  return (toCents(total) ?? 0) - rowsTotalCents(rows)
}

/** {@link remainderCents} as a display string, sign included. */
export function remainder(total: string, rows: SplitRow[]): string {
  return fromCents(remainderCents(total, rows))
}

/** True when the rows account for the total exactly. */
export function isFullyAllocated(total: string, rows: SplitRow[]): boolean {
  return remainderCents(total, rows) === 0
}

/**
 * Amount to seed a newly added row with: whatever is unallocated, so the common
 * two-way split is add → pick → type once, and the second row needs no typing
 * at all. Never seeds a negative — an overshoot seeds zero instead.
 */
export function seedAmountForNewRow(total: string, rows: SplitRow[]): string {
  return fromCents(Math.max(0, remainderCents(total, rows)))
}

/**
 * Keep a lone row's amount equal to the hero total.
 *
 * With one row the split editor is not really splitting, and making the user
 * retype the amount they just entered would be busywork. As soon as a second row
 * exists the amounts are explicit and this leaves them alone.
 */
export function syncSingleRow(rows: SplitRow[], total: string): SplitRow[] {
  if (rows.length !== 1) return rows
  const amount = total === '' ? '' : fromCents(toCents(total) ?? 0)
  if (rows[0].amount === amount) return rows
  return [{ ...rows[0], amount }]
}

/** Why the entry can't be submitted yet, or null when it can. */
export type SubmitBlocker =
  | 'no-wallet'
  | 'no-amount'
  | 'no-account'
  | 'unallocated'
  | 'over-allocated'

/**
 * The first thing standing between this entry and a saved transaction. Ordered
 * the way the user fills the screen in, so the hint always names the next thing
 * to do rather than the last thing wrong.
 */
export function submitBlocker(args: {
  walletId: string | null
  total: string
  rows: SplitRow[]
}): SubmitBlocker | null {
  const { walletId, total, rows } = args
  if (!walletId) return 'no-wallet'

  const totalCents = toCents(total)
  if (totalCents === null || totalCents <= 0) return 'no-amount'

  if (rows.length === 0 || rows.some((row) => !row.accountId)) return 'no-account'

  const left = remainderCents(total, rows)
  if (left > 0) return 'unallocated'
  if (left < 0) return 'over-allocated'
  return null
}

/** Convenience predicate over {@link submitBlocker}. */
export function canSubmitCash(args: {
  walletId: string | null
  total: string
  rows: SplitRow[]
}): boolean {
  return submitBlocker(args) === null
}

/** Human-readable reason, for the hint under the Add button. */
export function blockerMessage(blocker: SubmitBlocker, remainderText: string): string {
  switch (blocker) {
    case 'no-wallet':
      return 'Add a wallet first'
    case 'no-amount':
      return 'Enter an amount'
    case 'no-account':
      return 'Pick a category for each row'
    case 'unallocated':
      return `${remainderText} left to assign`
    case 'over-allocated':
      return `${remainderText.replace('-', '')} over the total`
  }
}

/**
 * The postings for a cash purchase: the wallet loses the total, each expense
 * account gains its share.
 *
 * Signs follow the ledger convention — the funding account is credited
 * (negative) and the expense accounts are debited (positive), the same shape the
 * import path produces. Every leg carries the wallet's currency: this story is
 * single-currency, and a cross-currency purchase is the top-up flow's job.
 *
 * Throws when the rows don't balance the total or an account is missing. The
 * backend rejects both, and failing here — where the message can be specific —
 * beats a round trip that comes back with a generic error.
 */
export function buildCashPostings(args: {
  walletAccountId: string
  currency: string
  total: string
  rows: SplitRow[]
}): PostingInput[] {
  const { walletAccountId, currency, total, rows } = args

  const totalCents = toCents(total)
  if (totalCents === null || totalCents <= 0) {
    throw new Error('Enter an amount greater than zero')
  }
  if (rows.length === 0) throw new Error('Add at least one category')

  const legs: PostingInput[] = []
  for (const row of rows) {
    if (!row.accountId) throw new Error('Every split row needs a category')
    const cents = toCents(row.amount)
    if (cents === null || cents <= 0) throw new Error('Every split row needs an amount')
    legs.push({ accountId: row.accountId, amount: fromCents(cents), currency })
  }

  const allocated = legs.reduce((sum, leg) => sum + (toCents(leg.amount) ?? 0), 0)
  if (allocated !== totalCents) {
    throw new Error(`Splits must add up to ${fromCents(totalCents)}`)
  }

  return [{ accountId: walletAccountId, amount: fromCents(-totalCents), currency }, ...legs]
}

/**
 * Merge rows that name the same account, summing their amounts.
 *
 * Two rows against one account are a legal transaction but a confusing one to
 * read back, and hledger treats repeated postings to an account as separate
 * lines. Collapsing them keeps the ledger tidy without refusing the entry.
 */
export function mergeRowsByAccount(rows: SplitRow[]): SplitRow[] {
  const merged: SplitRow[] = []
  for (const row of rows) {
    const existing = row.accountId
      ? merged.find((m) => m.accountId === row.accountId)
      : undefined
    if (!existing) {
      merged.push({ ...row })
      continue
    }
    existing.amount = fromCents((toCents(existing.amount) ?? 0) + (toCents(row.amount) ?? 0))
  }
  return merged
}
