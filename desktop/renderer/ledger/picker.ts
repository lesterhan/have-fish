// What a picked name sends: an account of mine by id, an income source or a category by name.
// The path picker's own rules (levels, search, new names) are in `pathPicker.ts`.

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

/** The option what I typed names, without regard to case or the spaces around it. */
export const named = <O extends Option>(options: readonly O[], typed: string): O | undefined =>
  options.find((o) => o.name.toLowerCase() === typed.trim().toLowerCase())

/** What To sends: an account of mine it names, which makes a transfer; else a category, as typed. */
export function toOf(accounts: readonly Option[], typed: string): To {
  const account = named(accounts, typed)
  return account === undefined ? { category: typed } : { account: account.id }
}

/**
 * What a spend's From field sends: null when it's empty, so main assumes the account used last;
 * the id of an account of mine it names; else an income source, as typed, which makes it income.
 */
export function fromOf(accounts: readonly Option[], typed: string): From {
  if (typed.trim() === '') return null
  return named(accounts, typed)?.id ?? { income: typed }
}
