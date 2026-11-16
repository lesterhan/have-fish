// The bench's tokens: what tokens.css declares, the panel's fields over its space and type, what
// was changed there or in the theme lab, and the block they export as. No DOM; `bench.ts` draws.

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
