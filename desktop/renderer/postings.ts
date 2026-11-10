// A transaction as text, for the postings block in its details: its date and description, then
// one line per posting with the accounts and amounts in columns, and whether each currency
// balances. Plain text, so Copy puts something another tool can read.

import { cents } from '@have-fish/core/money'
import { copy, type OriginPart } from '../copy'
import type { ListedLeg, ListedOrigin } from '../shared/commands'

/** One posting, as the block shows it. */
export type Posting = {
  /** Its account's path, null when the account isn't here yet. */
  path: string | null
  /** Its account's path, or what to call an account that isn't here yet. */
  account: string
  amount: string
  currency: string
}

/** The columns every posting is padded to, so the amounts and codes line up. */
export type Widths = { account: number; amount: number }

/** A currency's postings add up to zero, or they don't. */
export type Balance = { currency: string; ok: boolean }

const INDENT = '    '
const GAP = '  '

export function postingsOf(legs: readonly ListedLeg[], missing: string): Posting[] {
  return legs.map(({ path, amount, currency }) => ({
    path,
    account: path ?? missing,
    amount,
    currency,
  }))
}

export function widthsOf(postings: readonly Posting[]): Widths {
  return {
    account: Math.max(0, ...postings.map((p) => p.account.length)),
    amount: Math.max(0, ...postings.map((p) => p.amount.length)),
  }
}

/** The whole transaction: its first line, then each posting on a line of its own. */
export function postingsText(
  transaction: { date: string; description: string; legs: readonly ListedLeg[] },
  missing: string,
): string {
  const postings = postingsOf(transaction.legs, missing)
  const widths = widthsOf(postings)
  const header = [transaction.date, transaction.description].filter((part) => part !== '').join(' ')
  return [
    header,
    ...postings.map(
      (p) =>
        `${INDENT}${p.account.padEnd(widths.account)}${GAP}${p.amount.padStart(widths.amount)} ${p.currency}`,
    ),
  ].join('\n')
}

/** Each currency's postings, in the order they first appear, and whether they sum to zero. */
export function balancesOf(legs: readonly ListedLeg[]): Balance[] {
  const sums = new Map<string, number>()
  for (const { amount, currency } of legs) {
    sums.set(currency, (sums.get(currency) ?? 0) + cents(amount))
  }
  return [...sums].map(([currency, sum]) => ({ currency, ok: sum === 0 }))
}

/**
 * Where a transaction came from: by hand or the app, or an import's file and line, then when and
 * on which computer. A file's name is a part of its own, so the foot can set it in the code face.
 */
export function provenanceOf(
  origin: ListedOrigin,
  when: (at: number) => string,
  words = copy.spends.card.origin,
): OriginPart[] {
  const place = origin.here ? words.here : words.elsewhere
  if (origin.source === 'import' && origin.file !== null && origin.line !== null) {
    return words.imported(origin.file, origin.line, when(origin.at), place)
  }
  if (origin.source === 'system') return words.system(when(origin.at), place)
  return words.manual(when(origin.at), place)
}

/** An account's path split so its root can carry its kind's colour: `expenses` and `:food`. */
export function rootAndRest(account: string): { root: string; rest: string } {
  const at = account.indexOf(':')
  return at === -1
    ? { root: account, rest: '' }
    : { root: account.slice(0, at + 1), rest: account.slice(at + 1) }
}
