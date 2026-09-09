import { oklchToHex } from './oklch'

/**
 * The six accents, derived rather than authored.
 *
 * These used to be twelve hand-picked palettes — six accents times two themes, each with six
 * hex values written out. Hand-picking is where the spread came from: measured against the
 * page, the accents ran from 2.64:1 (ochre in light) to 9.52:1 (the same ochre in dark). Four
 * of six failed the 4.5:1 floor in light. The accent is the one rung a user can move, and
 * nothing constrained where they moved it to.
 *
 * So an accent is now two numbers — a hue and a chroma — and every value it produces is that
 * hue placed on a fixed rung. Twelve variants, all landing between 4.6:1 and 5.6:1 against
 * `--color-window`. Adding a seventh accent means adding one line, and it is on the rung by
 * construction rather than by somebody's eye.
 *
 * The rungs are lightnesses, not ratios, for the reason DESIGN.md §5 gives: a ratio is a
 * function of a pair, so it cannot be the coordinate of a single colour. That the ratios come
 * out in a tight band is the *consequence* of everything sitting at one lightness, and it is
 * what `accent.test.ts` checks.
 */

type Role = 'hex' | 'hi' | 'chipBg' | 'chipFg' | 'fg'

/**
 * Hue in degrees, and the chroma the accent is drawn at. Five sit at the same cap; slate is
 * deliberately near-grey — it is the accent for people who do not want one, and raising its
 * chroma to match the others would defeat the only thing it is for.
 */
const ACCENT_HUES = {
  aqua: { hue: 250, chroma: 0.115 },
  sage: { hue: 150, chroma: 0.115 },
  persimmon: { hue: 47, chroma: 0.115 },
  plum: { hue: 327, chroma: 0.115 },
  ochre: { hue: 85, chroma: 0.115 },
  slate: { hue: 253, chroma: 0.031 },
} as const

export type AccentKey = keyof typeof ACCENT_HUES

/**
 * Where each role sits on the ramp, per theme. A role occupies the same *position* in both —
 * `chipBg` is a faint wash of the accent either way — but the two themes read the ramp from
 * opposite ends, so the numbers are mirrored rather than shared.
 */
const RUNGS: Record<'light' | 'dark', Record<Role, number>> = {
  light: {
    hex: 0.52,
    hi: 0.64,
    chipBg: 0.925,
    chipFg: 0.4,
    fg: 0.995,
  },
  dark: {
    hex: 0.695,
    hi: 0.8,
    chipBg: 0.32,
    chipFg: 0.78,
    fg: 0.18,
  },
}

/**
 * How much of the accent's chroma each role keeps, and the ceiling it keeps it under. A
 * fraction rather than a fixed chroma so slate stays near-grey all the way down: giving every
 * chip the same 0.030 would make slate's chip more colourful than slate.
 */
const CHROMA: Record<Role, { of: number; max: number }> = {
  hex: { of: 1, max: 1 },
  hi: { of: 1, max: 1 },
  chipBg: { of: 0.26, max: 0.03 },
  chipFg: { of: 0.87, max: 0.1 },
  fg: { of: 0.09, max: 0.01 },
}

export type AccentVariant = {
  hex: string
  hi: string
  chipBg: string
  chipFg: string
  titlebar: string
  /** Text ON an accent-filled surface. Near-white in light, near-black in dark. */
  fg: string
}

export type AccentDef = { light: AccentVariant; dark: AccentVariant }

function variant(key: AccentKey, theme: 'light' | 'dark'): AccentVariant {
  const { hue, chroma } = ACCENT_HUES[key]
  const at = (role: Role) =>
    oklchToHex({
      l: RUNGS[theme][role],
      c: Math.min(chroma * CHROMA[role].of, CHROMA[role].max),
      h: hue,
    })

  const hex = at('hex')
  const hi = at('hi')

  return {
    hex,
    hi,
    chipBg: at('chipBg'),
    chipFg: at('chipFg'),
    // The gloss runs from the highlight down to the accent itself, so the pill reads as lit
    // from above like every other control.
    titlebar: `linear-gradient(180deg,${hi},${hex})`,
    fg: at('fg'),
  }
}

export const ACCENTS: Record<AccentKey, AccentDef> = Object.fromEntries(
  (Object.keys(ACCENT_HUES) as AccentKey[]).map((key) => [
    key,
    { light: variant(key, 'light'), dark: variant(key, 'dark') },
  ]),
) as Record<AccentKey, AccentDef>

export function applyAccent(key: AccentKey, dark = false) {
  const a = ACCENTS[key][dark ? 'dark' : 'light']
  const s = document.documentElement.style
  s.setProperty('--color-accent', a.hex)
  s.setProperty('--color-accent-hi', a.hi)
  s.setProperty('--color-accent-chip-bg', a.chipBg)
  s.setProperty('--color-accent-chip-fg', a.chipFg)
  s.setProperty('--color-titlebar-accent', a.titlebar)
  s.setProperty('--color-dropdown-active', a.hex)
  s.setProperty('--color-accent-fg', a.fg)
}
