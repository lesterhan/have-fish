// Reads a tokens file into the theme the contract checks: the colours of `:root` as light, and
// the `prefers-color-scheme: dark` block over them as dark, the way the page resolves them.

import type { Palette, Schemes } from './contract'

type Block = { prelude: string; body: string }

const DARK = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/

export function readTheme(css: string): Schemes {
  const top = blocks(css.replace(/\/\*[\s\S]*?\*\//g, ''))
  const roots = top.filter((b) => b.prelude === ':root')
  if (roots.length === 0) throw new Error('no :root block to read colours from')

  const light = colours(roots)
  const dark = colours(top.filter((b) => DARK.test(b.prelude)).flatMap((b) => blocks(b.body)))
  return { light, dark: { ...light, ...dark } }
}

/** The blocks at the top level of `css`, each with its own nested text left whole. */
function blocks(css: string): Block[] {
  const found: Block[] = []
  let depth = 0
  let preludeAt = 0
  let bodyAt = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{' && depth++ === 0) bodyAt = i + 1
    else if (css[i] === '}' && --depth === 0) {
      found.push({ prelude: css.slice(preludeAt, bodyAt - 1).trim(), body: css.slice(bodyAt, i) })
      preludeAt = i + 1
    }
  }
  return found
}

/** The `--color-*` declarations of the `:root` blocks among `found`. */
function colours(found: Block[]): Palette {
  const palette: Record<string, string> = {}
  for (const { body } of found.filter((b) => b.prelude === ':root')) {
    for (const [, name, value] of body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) {
      const hex = (value as string).trim().toLowerCase()
      if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`${name} is not a #rrggbb colour: ${hex}`)
      palette[name as string] = hex
    }
  }
  return palette
}
