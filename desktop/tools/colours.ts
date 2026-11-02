// Finds a colour declared in source instead of read from `renderer/tokens.css`. Copied from the
// web app's `no-raw-colour.test.ts`; `renderer/tokens.test.ts` runs it over the app.
//
// Raw colour is any hex, any `rgb()` or `hsl()` with a hue, and a named colour in a declaration.
// Translucent neutrals (`rgba(0, 0, 0, 0.1)`) stay legal: they shade whatever is beneath them,
// which a flat token can't. So do `black` and `white` as a `color-mix` operand, for the same
// reason, and a `color-mix` with `transparent`, which tints a token and follows the theme.

const HEX = /#[0-9a-fA-F]{3,8}\b/g

/** `rgb()`, `rgba()`, `hsl()` and `hsla()`, and their arguments. */
const FUNCTIONAL = /\b(rgba?|hsla?)\(([^)]*)\)/g

const NAMED = new Set([
  'aqua',
  'aquamarine',
  'beige',
  'black',
  'blue',
  'brown',
  'coral',
  'crimson',
  'cyan',
  'fuchsia',
  'gold',
  'gray',
  'green',
  'grey',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lime',
  'magenta',
  'maroon',
  'navy',
  'olive',
  'orange',
  'orchid',
  'pink',
  'plum',
  'purple',
  'red',
  'salmon',
  'sienna',
  'silver',
  'tan',
  'teal',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'yellow',
])

/** A CSS declaration's value, enough to spot a named colour in it. */
const DECLARATION =
  /(^|[;{\s])([a-z-]*color|background|border(?:-[a-z]+)?|fill|stroke|outline)\s*:\s*([^;}\n]+)/g

/** Comments, which may quote the colours they're about. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
}

/** An `rgb()` whose three channels match is a neutral. An `hsl()` always has a hue. */
function isNeutral(fn: string, args: string): boolean {
  if (fn.startsWith('hsl')) return false
  const channels = args
    .split(/[,/\s]+/)
    .filter(Boolean)
    .slice(0, 3)
  return channels.length === 3 && new Set(channels).size === 1
}

export function rawColoursIn(source: string): string[] {
  const clean = stripComments(source)
  const found: string[] = []

  for (const [hex] of clean.matchAll(HEX)) found.push(hex)

  for (const [whole, fn, args] of clean.matchAll(FUNCTIONAL)) {
    if (!isNeutral(fn as string, args as string)) found.push(whole)
  }

  for (const [, , property, value] of clean.matchAll(DECLARATION)) {
    const declaration = (value as string).toLowerCase().replace(/%\s*,\s*(black|white)\s*\)/g, '%)')
    for (const word of declaration.split(/[^a-z-]+/)) {
      if (NAMED.has(word)) found.push(`${property}: ${word}`)
    }
  }

  return found
}
