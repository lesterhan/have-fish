// The picker's rules: which options what I typed finds, which one it names, and where the
// arrow keys move. The web app's `AccountPathInput` matched the same way.

import type { From, To } from '../shared/commands'

export type Option = { id: string; name: string }

/** Every character typed, in order, somewhere in the name, without regard to case: "vs" finds visa. */
export function finds(name: string, typed: string): boolean {
  const haystack = name.toLowerCase()
  const needle = typed.trim().toLowerCase()
  let at = 0
  for (const c of needle) {
    at = haystack.indexOf(c, at) + 1
    if (at === 0) return false
  }
  return true
}

/** The options what I typed finds, in the order given. Nothing typed finds them all. */
export const matching = <O extends Option>(options: readonly O[], typed: string): O[] =>
  options.filter((o) => finds(o.name, typed))

/** The option what I typed names, without regard to case or the spaces around it. */
export const named = <O extends Option>(options: readonly O[], typed: string): O | undefined =>
  options.find((o) => o.name.toLowerCase() === typed.trim().toLowerCase())

/** What the list shows: an option of mine, or a new one made from what I typed. */
export type Offer<O extends Option> = { kind: 'mine'; option: O } | { kind: 'new'; name: string }

/**
 * The options what I typed finds, and, where new ones can be made, the name typed as a new one
 * last, unless it names one I have already.
 */
export function offered<O extends Option>(
  options: readonly O[],
  typed: string,
  makesNew: boolean,
): Offer<O>[] {
  const mine = matching(options, typed).map((option) => ({ kind: 'mine' as const, option }))
  const name = typed.trim()
  if (!makesNew || name === '' || named(options, name) !== undefined) return mine
  return [...mine, { kind: 'new', name }]
}

/**
 * What To offers: the categories in the order given, then my accounts, each with its hint. A
 * category with an account's name is left out, since that name means the account.
 */
export function toOptions<A extends Option & { hint: string }>(
  categories: readonly Option[],
  accounts: readonly A[],
): (Option & { hint: string })[] {
  const own = categories.filter((c) => named(accounts, c.name) === undefined)
  return [...own.map(({ id, name }) => ({ id, name, hint: '' })), ...accounts]
}

/** What To sends: an account of mine it names, which makes a transfer; else a category, as typed. */
export function toOf(accounts: readonly Option[], typed: string): To {
  const account = named(accounts, typed)
  return account === undefined ? { category: typed } : { account: account.id }
}

/**
 * What From offers: my accounts, each with its hint, then the income sources in the order given.
 * A source with an account's name is left out, since that name means the account.
 */
export function fromOptions<A extends Option & { hint: string }>(
  accounts: readonly A[],
  income: readonly Option[],
  hint: string,
): (Option & { hint: string })[] {
  const sources = income.filter((s) => named(accounts, s.name) === undefined)
  return [...accounts, ...sources.map(({ id, name }) => ({ id, name, hint }))]
}

/**
 * What a spend's From field sends: null when it's empty, so main assumes the account used last;
 * the id of an account of mine it names; else an income source, as typed, which makes it income.
 */
export function fromOf(accounts: readonly Option[], typed: string): From {
  if (typed.trim() === '') return null
  return named(accounts, typed)?.id ?? { income: typed }
}
