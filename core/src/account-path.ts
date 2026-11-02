import { type AccountKind, rootOf } from './account-kind'

// A valid account path is colon-segmented with no empty segments and no surrounding
// whitespace: it refuses '', ':x', 'x:' and 'x::y'.
export function isValidPath(path: string): boolean {
  if (path !== path.trim() || path.length === 0) return false
  return path.split(':').every((seg) => seg.length > 0 && seg === seg.trim())
}

/** The path an account I name gets: its kind's root, then the name (`visa` as a card is `liabilities:visa`). */
export function pathFor(kind: AccountKind, name: string): string {
  return `${rootOf(kind)}:${name}`
}

/** The path without its root, as I named it: `liabilities:visa` is `visa`, `assets:wise:cad` is `wise:cad`. */
export function nameOf(path: string): string {
  const colon = path.indexOf(':')
  return colon === -1 ? path : path.slice(colon + 1)
}
