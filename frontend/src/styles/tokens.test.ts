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
 *
 * The same file now also carries the ladder — the ramp of surfaces every panel, band and
 * rule sits on. It is asserted in two different units, on purpose:
 *
 * - **Surfaces step by OKLCH ΔL**, not by contrast ratio. At the dark end a perceptually
 *   equal step produces a tiny ratio: the previous dark theme's section bar sat 1.24:1 from
 *   the page it headed while its light-theme counterpart sat at 11.45:1, and both were
 *   "correct" by ratio. Asking for a ratio between two adjacent surfaces either flattens the
 *   dark theme or blows the light one apart.
 * - **Ink steps by contrast ratio**, because that is what legibility is actually measured in
 *   and there is a standard to point at.
 *
 * The load-bearing assertion is the third one: the same element occupies the same rung in
 * both themes. Hierarchy has to be a property of the design, not of which theme you happen
 * to have on. Before this, the section bar's step diverged between themes by 61x.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { contrastRatio, deltaL, hexToOklch, luminance } from '$lib/oklch'

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

// The maths lives in `$lib/oklch` and is tested there; this file is about the values in
// `tokens.css`. `lightness` is the OKLCH coordinate — perceptually uniform, the unit surfaces
// step in. `contrastRatio` is WCAG, the unit ink steps in. See DESIGN.md §5 for why the two.
const lightness = (hex: string) => hexToOklch(hex).l

describe('the coverage strip reads as a picture in both themes', () => {
  // The trough is the uncovered state: an uncovered day is transparent, so what shows through
  // is literally the inset surface. Every other state is measured against it.
  const TROUGH = '--color-window-inset'

  const FILLS = [
    '--color-coverage-covered-hi',
    '--color-coverage-covered-lo',
    '--color-incomplete',
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

// --- the ladder ---------------------------------------------------------------------------

/**
 * The case — the titlebar and status bar shell — is not its own token; it is the bottom stop
 * of the titlebar gradient, which is the value that actually meets the desktop and the panel.
 * Measuring the declared gradient rather than a copy of it is the point.
 */
function caseColour(theme: Map<string, string>): string {
  const hexes = token(theme, '--color-titlebar-bg').match(/#[0-9a-f]{6}/gi)
  if (!hexes?.length)
    throw new Error('the titlebar gradient declares no stop to measure')
  return hexes.at(-1)!
}

/**
 * A step smaller than this is decoration. Two surfaces this close read as one surface with a
 * seam, which is what `Card` was doing at 1.06:1 — a panel nobody could see the edge of.
 */
const MIN_STEP = 0.04

/**
 * How far the two themes are allowed to disagree about the size of a step. The dark end
 * genuinely wants a slightly larger ΔL to look equal, so the rule is a factor rather than
 * equality. Before the ladder, the section bar's step diverged by 61x.
 */
const MAX_THEME_DIVERGENCE = 2

/**
 * `sameInBothThemes: false` marks a step whose *direction* legitimately flips between themes,
 * so only its size is asserted, per theme. There is exactly one, and it is worth naming: the
 * case is the physical shell, and a shell is always a mid-tone between the desktop behind it
 * and the panel inside it. In light that puts it below the window; in dark, above. Requiring
 * those two steps to match would be asserting a coincidence rather than a relationship — the
 * epic's first table asked for it and the values it shipped with diverged by 2.2x.
 */
const STEPS: Array<{
  what: string
  from: string
  to: string
  sameInBothThemes?: false
}> = [
  {
    what: 'the case against the desktop behind it',
    from: '--color-desktop',
    to: 'case',
  },
  {
    what: 'the case against the window it frames',
    from: 'case',
    to: '--color-window',
    sameInBothThemes: false,
  },
  {
    what: 'the window against the panel it sits on',
    from: '--color-window-raised',
    to: '--color-window',
  },
  {
    what: 'a section bar against the panel it heads',
    from: '--color-window-raised',
    to: '--color-section-bar-bg',
  },
  {
    what: 'a rule against the window it divides',
    from: '--color-window',
    to: '--color-rule',
  },
]

function surface(theme: Map<string, string>, name: string): string {
  return name === 'case' ? caseColour(theme) : token(theme, name)
}

describe('the surface ladder', () => {
  for (const step of STEPS) {
    describe(step.what, () => {
      for (const [name, theme] of Object.entries(THEMES)) {
        it(`is a real step in ${name}`, () => {
          const delta = deltaL(
            surface(theme, step.from),
            surface(theme, step.to),
          )
          expect(delta).toBeGreaterThanOrEqual(MIN_STEP)
        })
      }

      const measure = (theme: Map<string, string>) =>
        deltaL(surface(theme, step.from), surface(theme, step.to))

      if (step.sameInBothThemes === false) {
        it('is a step of its own size in each theme, because its direction flips', () => {
          // Named rather than skipped: the exemption is the assertion. All that is required
          // here is that neither theme lets the pair collapse into one surface.
          expect(measure(THEMES.light)).toBeGreaterThanOrEqual(MIN_STEP)
          expect(measure(THEMES.dark)).toBeGreaterThanOrEqual(MIN_STEP)
        })
      } else {
        it('is the same step in both themes', () => {
          // The load-bearing one. An element that is one rung off its background in light and
          // flush with it in dark is not one design with two palettes; it is two designs.
          const divergence =
            Math.max(measure(THEMES.light), measure(THEMES.dark)) /
            Math.min(measure(THEMES.light), measure(THEMES.dark))
          expect(divergence).toBeLessThanOrEqual(MAX_THEME_DIVERGENCE)
        })
      }
    })
  }

  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: the inset trough is the far end of the ramp, not a rung in the middle`, () => {
      // An input or a chart trough has to read as a hole cut in the panel. In light that means
      // lighter than every surface; in dark, darker than every one.
      const trough = lightness(token(theme, '--color-window-inset'))
      const others = [
        '--color-window',
        '--color-window-raised',
        '--color-section-bar-bg',
      ].map((surfaceToken) => lightness(token(theme, surfaceToken)))

      const extreme =
        name === 'light' ? Math.max(...others) : Math.min(...others)
      expect(name === 'light' ? trough > extreme : trough < extreme).toBe(true)
    })
  }
})

// --- ink ----------------------------------------------------------------------------------

/**
 * Ink rungs, as bands rather than exact ratios. A dark theme wants slightly brighter ink to
 * read as equally present, so asking the two themes to match to two decimals produces dull,
 * grudging dark colours — the first draft of this table did exactly that and the dark accent
 * came out the colour of a wet road. What matters is that a token lands on the same rung in
 * both themes, and a rung is a range.
 */
const INK_RUNGS: Array<{ token: string; min: number; max: number }> = [
  { token: '--color-text', min: 11, max: 16 },
  { token: '--color-text-muted', min: 5.5, max: 6.5 },
  { token: '--color-text-disabled', min: 4.5, max: 5.2 },
  { token: '--color-amount-positive', min: 4.5, max: 7 },
  { token: '--color-amount-negative', min: 4.5, max: 7 },
  { token: '--color-warning', min: 4.5, max: 7 },
]

describe('ink sits on the same rung in both themes', () => {
  for (const rung of INK_RUNGS) {
    for (const [name, theme] of Object.entries(THEMES)) {
      it(`${name}: ${rung.token}`, () => {
        const ratio = contrastRatio(
          token(theme, rung.token),
          token(theme, '--color-window'),
        )
        expect(ratio).toBeGreaterThanOrEqual(rung.min)
        expect(ratio).toBeLessThanOrEqual(rung.max)
      })
    }
  }

  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: a loss is as loud as a gain`, () => {
      // In the previous dark theme a loss measured 3.05:1 against a gain's 6.13:1, so the
      // number you most need to notice was the quieter of the two. Nothing in the design said
      // that; it fell out of borrowing two palette entries that happened not to match.
      const positive = contrastRatio(
        token(theme, '--color-amount-positive'),
        token(theme, '--color-window'),
      )
      const negative = contrastRatio(
        token(theme, '--color-amount-negative'),
        token(theme, '--color-window'),
      )

      expect(
        Math.max(positive, negative) / Math.min(positive, negative),
      ).toBeLessThan(1.5)
    })

    it(`${name}: disabled text is quiet, not invisible`, () => {
      // Disabled means "not now", not "unreadable". It still has to clear body-text contrast,
      // and it still has to be quieter than muted or the ladder has a rung doing nothing.
      const disabled = contrastRatio(
        token(theme, '--color-text-disabled'),
        token(theme, '--color-window'),
      )
      const muted = contrastRatio(
        token(theme, '--color-text-muted'),
        token(theme, '--color-window'),
      )

      expect(disabled).toBeGreaterThanOrEqual(MIN_TEXT_RATIO)
      expect(disabled).toBeLessThan(muted)
    })
  }
})

describe('magnitude marks are ink, not accent', () => {
  // A bar, block or sparkline is drawn in the trough a rule would divide, so that is what it
  // has to be legible against — and it has to be legible without the accent, which means "the
  // one live thing on this screen" and cannot also be the fill for nine category bars at once.
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: --color-bar-ink reads against the rule it is drawn over`, () => {
      const ratio = contrastRatio(
        token(theme, '--color-bar-ink'),
        token(theme, '--color-rule'),
      )
      expect(ratio).toBeGreaterThanOrEqual(MIN_RATIO)
    })

    it(`${name}: --color-incomplete is quieter than a complete mark but still a mark`, () => {
      const incomplete = contrastRatio(
        token(theme, '--color-incomplete'),
        token(theme, '--color-window-inset'),
      )
      const complete = contrastRatio(
        token(theme, '--color-bar-ink'),
        token(theme, '--color-window-inset'),
      )

      expect(incomplete).toBeGreaterThanOrEqual(MIN_RATIO)
      expect(incomplete).toBeLessThan(complete)
    })
  }
})
