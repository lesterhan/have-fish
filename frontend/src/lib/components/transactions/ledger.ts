import type { Posting, StoredAccountType, Transaction } from '$lib/api'
import { toCents } from '../../money'
import { accountIndex } from '../accounts/accountIndex'
import { amountTone, OWN_MONEY, type AmountTone } from './amountTone'

/**
 * The two things a ledger has to decide about a row, in one place.
 *
 * Both surfaces that render a ledger — the account page and the transactions list — need
 * the same two answers: which posting is the row *about*, and what does its sign mean. The
 * account page had worked this out already and the transactions list had not, so the same
 * screen idea was implemented once and skipped once. That is the drift §6 exists to stop.
 *
 * The subject is the posting on your own money. On an account page that is trivially the
 * account you are looking at. On the global list nobody has named an account, so it is the
 * posting on whichever side is an asset, liability or equity — the money that is yours,
 * with the expense or income account as its counterpart. Reducing both pages to "find the
 * subject, judge its sign against its counterpart" is what makes one rule cover both.
 */

/** The part of an `Account` this needs. `Account` from the API satisfies it. */
export interface TypedAccount {
  id: string
  path: string
  resolvedType?: StoredAccountType | null
}

/**
 * `accountId` → the type it resolved to, over an indexed lookup.
 *
 * Every function below takes this as a callback rather than the account list, because the
 * account page and the global list disagree about which account matters and agree about
 * nothing else. Four call sites had written the same closure by hand —
 * `accounts.find((a) => a.id === id)?.resolvedType ?? null` — and each one ran a linear scan
 * per posting inside a per-row `$derived`, so a page of two hundred rows over two hundred
 * accounts did eighty thousand comparisons to colour a column. `accountIndex` already
 * memoizes an id map on the array's identity for exactly this reason; it was built for the
 * account pickers and nothing else had found it.
 */
export function typeResolver(
  accounts: readonly TypedAccount[],
): (accountId: string) => StoredAccountType | null {
  const { byId } = accountIndex(accounts)
  return (id) => byId.get(id)?.resolvedType ?? null
}

/** The posting a ledger row is about, or null when nothing in the row is your own money. */
export function subjectPosting(
  postings: readonly Posting[],
  typeOf: (accountId: string) => StoredAccountType | null | undefined,
  currentAccountId?: string | null,
): Posting | null {
  if (currentAccountId) {
    return postings.find((p) => p.accountId === currentAccountId) ?? null
  }
  // A transfer has two candidates and either answers the question the same way, because a
  // counterpart that is also your own money is what makes it a transfer.
  return postings.find((p) => OWN_MONEY.has(typeOf(p.accountId) ?? '')) ?? null
}

/** V5's rule, resolved for one row. See `amountTone` for what the three tones mean. */
export function ledgerTone(
  postings: readonly Posting[],
  typeOf: (accountId: string) => StoredAccountType | null | undefined,
  currentAccountId?: string | null,
): AmountTone {
  const subject = subjectPosting(postings, typeOf, currentAccountId)
  if (!subject) return 'neutral'

  const counterpart = postings.find((p) => p.accountId !== subject.accountId)
  return amountTone(subject.amount, typeOf(counterpart?.accountId ?? ''))
}

// ── Days ────────────────────────────────────────────────────

export type DayNet =
  | { kind: 'net'; cents: number; currency: string }
  /**
   * A day whose rows are not all in one currency. Adding them would be inventing a rate the
   * user has not asked for, and picking one currency's subtotal would be a figure that looks
   * like the day's net and is not. So the band says which currencies and stays out of it —
   * an absence with a reason rather than a blank (V7).
   */
  | { kind: 'mixed'; currencies: string[] }
  /** Nothing in the day is your own money — an expense-to-expense reclassification, say. */
  | { kind: 'none' }

export type DayGroup = {
  /** `YYYY-MM-DD`. */
  date: string
  transactions: Transaction[]
  net: DayNet
}

/**
 * The day's net, over the subject postings only.
 *
 * Summing every posting would always give zero — a ledger balances — so what the band
 * reports is the movement on your own money: what the day did to you.
 */
export function dayNet(
  transactions: readonly Transaction[],
  typeOf: (accountId: string) => StoredAccountType | null | undefined,
  currentAccountId?: string | null,
): DayNet {
  const subjects = transactions
    .map((tx) => subjectPosting(tx.postings, typeOf, currentAccountId))
    .filter((p): p is Posting => p !== null)

  if (subjects.length === 0) return { kind: 'none' }

  const currencies = [...new Set(subjects.map((p) => p.currency))].sort()
  if (currencies.length > 1) return { kind: 'mixed', currencies }

  let cents = 0
  for (const posting of subjects) {
    const value = toCents(posting.amount)
    // An unparseable amount cannot be silently treated as zero: the net would be wrong and
    // would look right. One bad row makes the day's figure unavailable, like a mixed day.
    if (value === null) return { kind: 'mixed', currencies }
    cents += value
  }

  return { kind: 'net', cents, currency: currencies[0]! }
}

/**
 * Consecutive runs of one date, in the order given.
 *
 * Runs rather than a keyed grouping: the caller has already sorted, and re-sorting here
 * would silently repair a list that was ordered some other way on purpose. If a date appears
 * twice with something else between, that is two runs, which is the honest rendering of the
 * order it was handed.
 */
export function groupByDay(
  transactions: readonly Transaction[],
  typeOf: (accountId: string) => StoredAccountType | null | undefined,
  currentAccountId?: string | null,
): DayGroup[] {
  const groups: DayGroup[] = []

  for (const tx of transactions) {
    const date = tx.date.substring(0, 10)
    const last = groups.at(-1)
    if (last && last.date === date) last.transactions.push(tx)
    else groups.push({ date, transactions: [tx], net: { kind: 'none' } })
  }

  for (const group of groups) {
    group.net = dayNet(group.transactions, typeOf, currentAccountId)
  }

  return groups
}
