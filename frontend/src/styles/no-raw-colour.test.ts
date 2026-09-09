/**
 * Keeps colour in the token file.
 *
 * `tokens.css` can only be the single source of truth for how the app looks if nothing else
 * declares a colour. That was not true when this test was written: nine components held 45
 * raw hex values between them, and the worst was invisible to every other check in the repo.
 * `CurrencyPill` carried a 33-entry currency→colour map applied as an *inline style*, so it
 * beat the class underneath it, was authored against the light theme only, and put a pale
 * pink sticker on every money row in dark mode. `tokens.test.ts` could not see it, because
 * none of it was a token. A component test could not see it either, because the values only
 * meet the theme in the compositor.
 *
 * So the invariant is asserted against the *source*, the same arrangement `copy.test.ts`
 * uses for user-facing strings: one file owns a category of values, and a test stops that
 * category leaking back out everywhere else.
 *
 * What counts as raw colour here:
 *
 * - **Any hex literal** — `#fff`, `#f4f0e6`, `#f4f0e64d`. There is no legitimate use of one
 *   outside `tokens.css`; if a component needs a value the token file does not have, the
 *   answer is a new token with an assertion, not a hex in a scoped `<style>` block.
 * - **Any `rgb()`/`hsl()` carrying a hue.** Translucent *neutrals* are deliberately allowed:
 *   `rgba(0, 0, 0, 0.08)` and `rgba(255, 255, 255, 0.6)` are shadow and gloss, which modulate
 *   whatever surface is beneath them rather than declaring a colour of their own — the one
 *   thing a flat token genuinely cannot express. An `rgb()` whose channels differ is a colour
 *   wearing a function's clothes, and is caught.
 * - **CSS named colours** in a declaration, which are hexes with better PR — except `black`
 *   and `white` as a `color-mix` operand, which is the same shading move as a translucent
 *   neutral written a different way (`color-mix(…, var(--color-accent) 80%, black)` is the
 *   bottom of a gradient, not a colour someone chose).
 *
 * `color-mix(…, var(--token) 30%, transparent)` is fine and is the intended escape hatch for
 * a tint: it derives from a token, so it follows the theme.
 *
 * One file is a colour *source* and is exempt wholesale — see `COLOUR_SOURCES`. It was two:
 * `accent.ts` held twelve hand-authored palettes until they were replaced by a hue and a
 * chroma per accent, at which point it stopped declaring any colour at all.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { sourceFilesUnder, stripNoise } from '../testing/source-scan'

/** `frontend/src`, from `frontend/src/styles`. */
const SRC = join(import.meta.dir, '..')

/**
 * Files that are allowed to be a source of colour, relative to `src/`, with the reason.
 * Adding one is a design decision, not a way past a failing test.
 */
const COLOUR_SOURCES: Array<{ file: string; why: string }> = [
  {
    file: 'styles/tokens.css',
    why: 'The token file. This is the single source of truth the rest of the test defends.',
  },
]

/**
 * Files allowed to hold a raw colour anyway, with the reason it was argued for. Keep this
 * empty if you can. An entry that no longer matches anything fails the test, which is what
 * stops the list becoming a graveyard.
 */
const ALLOWED: Array<{ file: string; value: string; why: string }> = []

// --- finding the files ------------------------------------------------------------------

const EXTENSIONS = ['.svelte', '.css', '.ts']

const FILES = sourceFilesUnder(SRC, EXTENSIONS)
  .map((full) => relative(SRC, full))
  .filter((file) => !COLOUR_SOURCES.some((source) => source.file === file))
  .filter((file) => !file.endsWith('.test.ts')) // a test may quote the value it is asserting
  .sort()

// --- the detectors ----------------------------------------------------------------------

const HEX = /#[0-9a-fA-F]{3,8}\b/g

/** `rgb()`/`rgba()`/`hsl()`/`hsla()` and their arguments, however they are spelled. */
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

/** A CSS declaration's value, for `property: value;` — enough to spot a named colour. */
const DECLARATION =
  /(^|[;{\s])([a-z-]*color|background|border(?:-[a-z]+)?|fill|stroke|outline)\s*:\s*([^;}\n]+)/g

/**
 * A `hsl()` always carries a hue. An `rgb()` carries one only when its channels differ —
 * `rgba(0, 0, 0, 0.08)` is a shadow and stays legal.
 */
function isNeutral(fn: string, args: string): boolean {
  if (fn.startsWith('hsl')) return false
  const channels = args
    .split(/[,/\s]+/)
    .filter(Boolean)
    .slice(0, 3)
  if (channels.length < 3) return false
  return new Set(channels).size === 1
}

function rawColoursIn(source: string): string[] {
  const clean = stripNoise(source)
  const found: string[] = []

  for (const [hex] of clean.matchAll(HEX)) found.push(hex)

  for (const [whole, fn, args] of clean.matchAll(FUNCTIONAL)) {
    if (!isNeutral(fn!, args!)) found.push(whole)
  }

  for (const [, , property, value] of clean.matchAll(DECLARATION)) {
    // `black` and `white` inside a color-mix are shading a token, not naming a colour.
    const declaration = value!
      .toLowerCase()
      .replace(/%\s*,\s*(black|white)\s*\)/g, '%)')
    for (const word of declaration.split(/[^a-z-]+/)) {
      if (NAMED.has(word)) found.push(`${property}: ${word}`)
    }
  }

  return found
}

// --- the contract -----------------------------------------------------------------------

describe('the detectors themselves', () => {
  it('catches a hex in a style block', () => {
    expect(rawColoursIn('.a { color: #8a5500; }')).toEqual(['#8a5500'])
  })

  it('catches a hex hidden in an inline style attribute', () => {
    // The CurrencyPill bug: an inline style beats the class, so the token underneath it was
    // never reached and no other check in the repo could see the value.
    expect(rawColoursIn('<span style="background:#f0d8d8">CAD</span>')).toEqual(
      ['#f0d8d8'],
    )
  })

  it('catches a named colour', () => {
    expect(rawColoursIn('.a { background: white; }')).toEqual([
      'background: white',
    ])
  })

  it('catches an rgb() that carries a hue', () => {
    expect(rawColoursIn('.a { color: rgb(200, 40, 40); }')).toEqual([
      'rgb(200, 40, 40)',
    ])
  })

  it('leaves translucent neutrals alone — they are shadow and gloss, not colour', () => {
    expect(
      rawColoursIn('.a { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }'),
    ).toEqual([])
    expect(
      rawColoursIn(
        '.a { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65); }',
      ),
    ).toEqual([])
  })

  it('leaves a tint derived from a token alone', () => {
    expect(
      rawColoursIn(
        '.a { border-color: color-mix(in srgb, var(--color-warning) 30%, transparent); }',
      ),
    ).toEqual([])
  })

  it('leaves black and white alone when they are shading a token', () => {
    expect(
      rawColoursIn(
        '.a { background: color-mix(in srgb, var(--color-accent) 80%, black); }',
      ),
    ).toEqual([])
  })

  it('still catches black when it is the colour itself', () => {
    expect(rawColoursIn('.a { color: black; }')).toEqual(['color: black'])
  })

  it('does not read a comment as a declaration', () => {
    // Several comments in this codebase quote the exact hexes of the bug they document.
    expect(
      rawColoursIn(
        '/* it ran from #3b4252 down to #20242d */ .a { color: var(--x); }',
      ),
    ).toEqual([])
  })
})

describe('colour lives in tokens.css and nowhere else', () => {
  const allowed = new Map(
    ALLOWED.map((entry) => [`${entry.file}::${entry.value}`, entry]),
  )
  const used = new Set<string>()

  for (const file of FILES) {
    const found = rawColoursIn(readFileSync(join(SRC, file), 'utf8')).filter(
      (value) => {
        const key = `${file}::${value}`
        if (!allowed.has(key)) return true
        used.add(key)
        return false
      },
    )

    if (found.length === 0) continue
    it(`${file} declares no colour of its own`, () => {
      expect(found).toEqual([])
    })
  }

  it('scanned the app rather than an empty directory', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('names a reason for every colour source', () => {
    for (const source of COLOUR_SOURCES) {
      expect(statSync(join(SRC, source.file)).isFile()).toBe(true)
      expect(source.why.length).toBeGreaterThan(20)
    }
  })

  it('has no stale exemptions', () => {
    const stale = [...allowed.keys()].filter((key) => !used.has(key))
    expect(stale).toEqual([])
  })
})
