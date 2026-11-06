// A path's rules: its root becomes a tag's initial, and the rest reads parents then the last part.

/** The roots a tag has a colour for; equity's tag is plain. */
export const TINTED = ['assets', 'liabilities', 'expenses', 'income'] as const

// Each root's own letter: equity's initial is expenses', so it takes the next of its word.
const TAGS: Record<string, string> = {
  assets: 'a',
  liabilities: 'l',
  expenses: 'e',
  income: 'i',
  equity: 'q',
}

/** `liabilities:cibc:visa` as `Path` shows it: an `l` tag, `cibc:` quiet, `visa` at 500. */
export function pathOf(path: string): {
  root: string
  tag: string
  parents: string[]
  leaf: string
} {
  const [root = '', ...rest] = path.split(':')
  const leaf = rest.pop() ?? root
  return { root, tag: TAGS[root] ?? root.slice(0, 1), parents: rest, leaf }
}
