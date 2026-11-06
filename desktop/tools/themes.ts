// Writes the built-in themes' colours into `renderer/tokens.css`: Graphite light in `:root`, and
// Graphite dark for `prefers-color-scheme: dark`, which `nativeTheme` picks between at launch.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deriveTokens } from '../shared/theme/derive'
import { BUILTINS, FOR_SCHEME } from '../shared/theme/theme'

export const TOKENS = fileURLToPath(new URL('../renderer/tokens.css', import.meta.url))

const START =
  '/* The colours, from the built-in themes: `bun run themes` writes them. Never by hand. */'
const END = '/* End of the colours. */'

const declarations = (palette: Record<string, string>, indent: string) =>
  Object.entries(palette)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n')

/** The block `tokens.css` holds between its markers. */
export function renderColours(): string {
  const light = deriveTokens(BUILTINS[FOR_SCHEME.light])
  const dark = deriveTokens(BUILTINS[FOR_SCHEME.dark])
  return `${START}
:root {
${declarations(light, '  ')}
}

@media (prefers-color-scheme: dark) {
  :root {
${declarations(dark, '    ')}
  }
}
${END}`
}

/** The block between the markers in `css`, or null without them. */
export function coloursIn(css: string): string | null {
  const from = css.indexOf(START)
  const to = css.indexOf(END)
  return from === -1 || to < from ? null : css.slice(from, to + END.length)
}

/** `css` with its colours block written afresh. */
export function withColours(css: string): string {
  const old = coloursIn(css)
  if (old === null) throw new Error('tokens.css has lost its colour markers')
  return css.replace(old, renderColours())
}

if (import.meta.main) writeFileSync(TOKENS, withColours(readFileSync(TOKENS, 'utf8')))
