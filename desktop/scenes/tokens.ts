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
    const value = declaration.slice(colon + 1).trim().replace(/\s+/g, ' ')
    return [{ name, value }]
  })
}
