// The bench's tokens: what tokens.css declares, the panel's fields over its space and type, what
// was changed there or in the theme lab, and the block to paste. No DOM; `bench.ts` draws.

import { SCHEMES } from '../shared/theme/contract'
import { deriveTokens } from '../shared/theme/derive'
import { BUILT_IN_LAB, type Lab } from './lab'

/** A custom property tokens.css declares, and its value there. */
export type Token = { name: string; value: string }

/** Every custom property in the first `:root` of `css`, in its order: all but the colours. */
export function tokensIn(css: string): Token[] {
  const block = /:root\s*\{([^}]*)\}/.exec(withoutComments(css))?.[1] ?? ''
  return declarationsIn(block).filter((token) => token.name.startsWith('--'))
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function declarationsIn(block: string): Token[] {
  return block.split(';').flatMap((declaration) => {
    const colon = declaration.indexOf(':')
    if (colon === -1) return []
    const name = declaration.slice(0, colon).trim()
    const value = declaration
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, ' ')
    return [{ name, value }]
  })
}

/** One fieldset of the panel: its legend, and its fields in tokens.css's order. */
export type Group = { title: string; tokens: Token[] }

/** The panel's fieldsets, and how each of its tokens' names starts. */
const GROUPS: readonly { title: string; starts: readonly string[] }[] = [
  { title: 'Type', starts: ['--font', '--text-', '--weight-', '--line-height'] },
  { title: 'Space', starts: ['--space-'] },
]

/** The panel's fields, in tokens.css's order, but for a token a density sets. */
export function groupsOf(css: string): Group[] {
  const tokens = tokensIn(css)
  // A density's own tokens are its control's: inline, they would outrank `[data-density]`.
  const densities = [...withoutComments(css).matchAll(/\[data-density='[^']*'\]\s*\{([^}]*)\}/g)]
  const owned = new Set(
    densities.flatMap((match) => declarationsIn(match[1] ?? '')).map((token) => token.name),
  )
  return GROUPS.map(({ title, starts }) => ({
    title,
    tokens: tokens.filter(
      (token) => !owned.has(token.name) && starts.some((start) => token.name.startsWith(start)),
    ),
  }))
}

/** What was typed in each field, by its token's name. */
export type Typed = Readonly<Record<string, string>>

/** Each field whose text, trimmed and not empty, isn't its token's value in tokens.css. */
export function changedOf(fields: readonly Token[], typed: Typed): Token[] {
  return fields.flatMap(({ name, value }) => {
    const text = typed[name]?.trim()
    return text === undefined || text === '' || text === value ? [] : [{ name, value: text }]
  })
}

/** Every field's token on a frame's root: its changed value, or '' to leave tokens.css's. */
export function styleOf(fields: readonly Token[], typed: Typed): Record<string, string> {
  const changed = new Map(changedOf(fields, typed).map((token) => [token.name, token.value]))
  return Object.fromEntries(fields.map(({ name }) => [name, changed.get(name) ?? '']))
}

/** A line every `--space-1` across and down a frame, which never takes a click. */
export const GRID_STYLE: Readonly<Record<string, string>> = {
  position: 'fixed',
  inset: '0',
  'pointer-events': 'none',
  'z-index': '2147483647',
  opacity: '0.3',
  'background-image':
    'linear-gradient(to right, GrayText 1px, transparent 1px), linear-gradient(to bottom, GrayText 1px, transparent 1px)',
  'background-size': 'var(--space-1) var(--space-1)',
}

/** Each token changed in the panel, then each colour the lab changed, light then dark. */
export function pasteOf(fields: readonly Token[], typed: Typed, lab: Lab): string {
  const panel = changedOf(fields, typed).map(({ name, value }) => `${name}: ${value};`)
  const colours = SCHEMES.flatMap((scheme) => {
    const builtIn = deriveTokens(BUILT_IN_LAB[scheme])
    return Object.entries(deriveTokens(lab[scheme]))
      .filter(([name, value]) => value !== builtIn[name])
      .map(([name, value]) => `${name}: ${value}; /* ${scheme} */`)
  })
  return [...panel, ...colours].join('\n')
}
