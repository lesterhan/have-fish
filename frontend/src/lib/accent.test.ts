/**
 * The accent is the one rung the user can move, and this is what constrains where.
 *
 * Before the accents were derived, four of six failed 4.5:1 against the page in light while
 * the same four sailed past 9:1 in dark — ochre was 2.64:1 and 9.52:1, the same choice, an
 * unreadable label in one theme and a shout in the other. Nothing in the code said what an
 * accent was allowed to be, so twelve hand-picked palettes each drifted where its author's
 * eye took it.
 *
 * These assertions are the replacement for that eye. They run against `tokens.css` as well as
 * `accent.ts`, because "legible" is a claim about a pair and the other half of every pair
 * lives in the token file. That crossing is the point: it is the only place in the suite where
 * the app's two sources of colour are measured against each other.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ACCENTS, type AccentKey } from './accent'
import { contrastRatio, deltaL, hexToOklch } from './oklch'

const TOKENS = readFileSync(
  fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
  'utf8',
)

/** One token's value out of one theme block. Small on purpose — this needs two values. */
function tokenValue(selector: string, name: string): string {
  const start = TOKENS.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`)
  const body = TOKENS.substring(start, TOKENS.indexOf('}', start))
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)
  if (!match) throw new Error(`${name} is not defined in ${selector}`)
  return match[1]!.trim()
}

const WINDOW = {
  light: tokenValue(':root {', '--color-window'),
  dark: tokenValue("[data-theme='dark'] {", '--color-window'),
}

/** Every accent variable the token file declares, paired with the field that supplies it. */
const FALLBACK_TOKENS: Array<
  [string, keyof (typeof ACCENTS)['aqua']['light']]
> = [
  ['--color-accent', 'hex'],
  ['--color-accent-hi', 'hi'],
  ['--color-accent-chip-bg', 'chipBg'],
  ['--color-accent-chip-fg', 'chipFg'],
  ['--color-accent-fg', 'fg'],
  ['--color-dropdown-active', 'hex'],
]

const THEMES = ['light', 'dark'] as const
const KEYS = Object.keys(ACCENTS) as AccentKey[]

/** WCAG 1.4.3 for body text. An accent is used on labels and links, so it is body text. */
const MIN_TEXT_RATIO = 4.5

/**
 * How far the twelve are allowed to spread. Not a WCAG number — a design one: if picking
 * ochre makes the app quieter than picking aqua, the accent has stopped being a preference
 * and started being a legibility setting. The old spread was 3.6x.
 */
const MAX_SPREAD = 1.3

describe('every accent is legible on the page it is used on', () => {
  // The twelve. One assertion each, named so a failure says which accent in which theme.
  for (const key of KEYS) {
    for (const theme of THEMES) {
      it(`${key} in ${theme}`, () => {
        expect(
          contrastRatio(ACCENTS[key][theme].hex, WINDOW[theme]),
        ).toBeGreaterThanOrEqual(MIN_TEXT_RATIO)
      })
    }
  }

  it('and no accent is meaningfully louder than any other', () => {
    const ratios = KEYS.flatMap((key) =>
      THEMES.map((theme) =>
        contrastRatio(ACCENTS[key][theme].hex, WINDOW[theme]),
      ),
    )
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThanOrEqual(
      MAX_SPREAD,
    )
  })
})

describe('each accent keeps its identity', () => {
  for (const key of KEYS) {
    it(`${key} is the same hue in both themes`, () => {
      // What makes light-aqua and dark-aqua the same choice rather than two blues. The
      // tolerance is for 8-bit quantisation, which swings the measured hue of a near-grey
      // like slate by a degree or two.
      const light = hexToOklch(ACCENTS[key].light.hex).h
      const dark = hexToOklch(ACCENTS[key].dark.hex).h
      const apart = Math.abs(((light - dark + 540) % 360) - 180)
      expect(apart).toBeLessThanOrEqual(3)
    })
  }

  it('slate stays the near-grey option', () => {
    // The reason chroma is a fraction of the accent's own rather than a constant per role: a
    // fixed chip chroma would make slate's chip more colourful than slate.
    const others = KEYS.filter((key) => key !== 'slate')
    for (const theme of THEMES) {
      const slate = hexToOklch(ACCENTS.slate[theme].hex).c
      for (const key of others) {
        expect(slate).toBeLessThan(hexToOklch(ACCENTS[key][theme].hex).c / 2)
      }
      expect(hexToOklch(ACCENTS.slate[theme].chipBg).c).toBeLessThan(
        hexToOklch(ACCENTS.slate[theme].hex).c,
      )
    }
  })
})

describe('the derived roles hold up', () => {
  for (const key of KEYS) {
    for (const theme of THEMES) {
      const accent = ACCENTS[key][theme]

      it(`${key} ${theme}: chip text reads on chip background`, () => {
        expect(
          contrastRatio(accent.chipFg, accent.chipBg),
        ).toBeGreaterThanOrEqual(MIN_TEXT_RATIO)
      })

      it(`${key} ${theme}: text on an accent fill reads`, () => {
        // The selected sidebar item, the primary button. `fg` is the only text-on-accent
        // token there is, so if it fails here it fails everywhere at once.
        expect(contrastRatio(accent.fg, accent.hex)).toBeGreaterThanOrEqual(
          MIN_TEXT_RATIO,
        )
      })

      it(`${key} ${theme}: the highlight is above the accent, not beside it`, () => {
        // The titlebar pill is a gradient from `hi` down to `hex`. If they land on the same
        // rung the gloss disappears; if they are far apart it stops looking like one control.
        const step = deltaL(accent.hi, accent.hex)
        expect(step).toBeGreaterThan(0.06)
        expect(step).toBeLessThan(0.2)
        expect(hexToOklch(accent.hi).l).toBeGreaterThan(
          hexToOklch(accent.hex).l,
        )
      })
    }
  }
})

describe('the two themes are the same design', () => {
  for (const key of KEYS) {
    it(`${key}: light and dark are equally present`, () => {
      const light = contrastRatio(ACCENTS[key].light.hex, WINDOW.light)
      const dark = contrastRatio(ACCENTS[key].dark.hex, WINDOW.dark)
      expect(Math.max(light, dark) / Math.min(light, dark)).toBeLessThan(1.3)
    })
  }

  it('text on an accent flips side between themes', () => {
    // In light the accent is a mid-tone under near-white text; in dark it is a light tone
    // under near-black text. Asserted because it is the one accent value whose *direction*
    // changes, and a copy-paste that lost the flip would produce white on pale blue.
    for (const key of KEYS) {
      expect(hexToOklch(ACCENTS[key].light.fg).l).toBeGreaterThan(0.9)
      expect(hexToOklch(ACCENTS[key].dark.fg).l).toBeLessThan(0.3)
    }
  })
})

describe("tokens.css's fallback is the accent it claims to be", () => {
  // The token file declares the default accent so the page is not colourless before hydration
  // — and then accent.ts overwrites the same variables from the derived table. Nothing forces
  // the two to agree, and a disagreement is invisible in code review and lasts about 200ms on
  // screen, which is exactly long enough to be reported as "it flashes the wrong blue".
  const SELECTOR = { light: ':root {', dark: "[data-theme='dark'] {" }

  for (const theme of THEMES) {
    for (const [name, field] of FALLBACK_TOKENS) {
      it(`${theme}: ${name}`, () => {
        expect(tokenValue(SELECTOR[theme], name)).toBe(
          ACCENTS.aqua[theme][field],
        )
      })
    }

    it(`${theme}: --color-titlebar-accent`, () => {
      // Written with the spaces prettier puts in; compared on the colours, which is the part
      // that has to match.
      const declared = tokenValue(
        SELECTOR[theme],
        '--color-titlebar-accent',
      ).match(/#[0-9a-f]{6}/gi)
      expect(declared).toEqual([
        ACCENTS.aqua[theme].hi,
        ACCENTS.aqua[theme].hex,
      ])
    })
  }
})
