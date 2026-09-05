/**
 * Contrast contracts that the token file has to keep.
 *
 * These are not style preferences. The coverage strip draws its three states as fills over a
 * shared trough, so if a fill and the trough land at the same lightness the picture stops
 * carrying information — which is exactly what shipped: the covered gradient was borrowed
 * from the button tokens, and in the dark palette it ran from #3b4252 down to #20242d while
 * the trough sat at #232731. The bottom two thirds of every "covered" day was *darker* than
 * the hole it was meant to contrast with.
 *
 * A component test cannot catch that; the values only meet each other in the compositor. So
 * the invariant is asserted against the token file itself.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TOKENS = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf8',
)

/**
 * WCAG 1.4.11 asks 3:1 for graphical objects you need to see to understand the content. Every
 * mark in the strip is one of those — a day you cannot pick out of the band is a day the
 * picture failed to report.
 */
const MIN_RATIO = 3

/** WCAG 1.4.3 asks 4.5:1 for body text. A tooltip is a sentence, so it is body text. */
const MIN_TEXT_RATIO = 4.5

// --- reading the token file ---------------------------------------------------------------

/** The declarations inside one top-level selector block, as a name → value map. */
function themeBlock(selector: string): Map<string, string> {
  const start = TOKENS.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`)

  // The blocks are top-level and hold no nested braces, so the first closing brace ends it.
  const end = TOKENS.indexOf('}', start)
  const body = TOKENS.substring(start, end)

  const declarations = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(name, value.trim())
  }
  return declarations
}

const THEMES = {
  light: themeBlock(':root {'),
  dark: themeBlock("[data-theme='dark'] {"),
}

function token(theme: Map<string, string>, name: string): string {
  const value = theme.get(name)
  if (value === undefined)
    throw new Error(`${name} is not defined in this theme`)
  return value
}

// --- contrast ------------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new Error(`expected a 6-digit hex colour, got "${hex}"`)
  const n = Number.parseInt(match[1]!, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

describe('the contrast helpers themselves', () => {
  it('agrees with the two ratios everyone knows by heart', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('does not care which way round the pair is given', () => {
    expect(contrastRatio('#232731', '#6a7791')).toBeCloseTo(
      contrastRatio('#6a7791', '#232731'),
      10,
    )
  })
})

describe('the coverage strip reads as a picture in both themes', () => {
  // The trough is the uncovered state: an uncovered day is transparent, so what shows through
  // is literally the inset surface. Every other state is measured against it.
  const TROUGH = '--color-window-inset'

  const FILLS = [
    '--color-coverage-covered-hi',
    '--color-coverage-covered-lo',
    '--color-coverage-hatch',
  ]

  for (const [name, theme] of Object.entries(THEMES)) {
    describe(name, () => {
      const trough = token(theme, TROUGH)

      for (const fill of FILLS) {
        it(`${fill} is legible against the trough`, () => {
          const ratio = contrastRatio(token(theme, fill), trough)
          expect(ratio).toBeGreaterThanOrEqual(MIN_RATIO)
        })
      }

      it('keeps the whole covered gradient on one side of the trough', () => {
        // The original bug in one assertion. A gradient that straddles the trough's lightness
        // has a band inside it that vanishes, so a run of covered days stops reading as one
        // continuous stretch however well its endpoints measure.
        const troughLuminance = luminance(trough)
        const hi = luminance(token(theme, '--color-coverage-covered-hi'))
        const lo = luminance(token(theme, '--color-coverage-covered-lo'))

        const above = hi > troughLuminance && lo > troughLuminance
        const below = hi < troughLuminance && lo < troughLuminance
        expect(above || below).toBe(true)
      })

      it('keeps the gradient shallow enough to read as one fill', () => {
        // A steep gradient at 22px becomes a stripe rather than a surface, and at the compact
        // strip's 10px it is just a muddy average of its ends.
        const ratio = contrastRatio(
          token(theme, '--color-coverage-covered-hi'),
          token(theme, '--color-coverage-covered-lo'),
        )
        expect(ratio).toBeLessThan(1.6)
      })
    })
  }
})

describe('the tooltip is readable in both themes', () => {
  // A new fg/bg pair, so it gets an assertion with it (DESIGN.md §5). The pair is measured
  // opaque; the panel renders at 94% over a blurred backdrop, and the headroom over 4.5:1 is
  // what pays for that — which is the reason to assert the pair rather than eyeball the panel.
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: tooltip text on the tooltip panel`, () => {
      const ratio = contrastRatio(
        token(theme, '--color-tooltip-text'),
        token(theme, '--color-tooltip-bg'),
      )
      expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_RATIO)
    })

    it(`${name}: the panel's edge is visible against the page behind it`, () => {
      // The edge, not the fill. A dark panel over a dark page cannot clear 3:1 on fill alone
      // without going pale grey and stopping looking like a help tag — the first draft of this
      // assertion asked for exactly that and the dark theme failed it at 1.29:1. What has to
      // be legible is where the panel stops, and that is the hairline's job.
      const ratio = contrastRatio(
        token(theme, '--color-tooltip-border'),
        token(theme, '--color-window-raised'),
      )
      expect(ratio).toBeGreaterThanOrEqual(MIN_RATIO)
    })
  }
})
