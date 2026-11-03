// The picker's rules: which options what I typed finds, which one it names, and where the
// arrow keys move. The web app's `AccountPathInput` matched the same way.

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

/** Where the arrow keys take the active option, wrapping at the ends; undefined for other keys. */
export function stepped(active: number, key: string, count: number): number | undefined {
  if (count === 0) return undefined
  if (key === 'ArrowDown') return (active + 1) % count
  if (key === 'ArrowUp') return (active - 1 + count) % count
  return undefined
}

/**
 * What a spend's From field sends: null when it's empty, so main assumes the account used last;
 * the id of the account it names; or undefined when it names none of mine.
 */
export function fromOf(options: readonly Option[], typed: string): string | null | undefined {
  if (typed.trim() === '') return null
  return named(options, typed)?.id
}
