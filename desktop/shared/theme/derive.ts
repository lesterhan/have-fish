// Every colour token, derived from a theme's inputs. Each sits on a fixed rung of OKLCH lightness
// per scheme, so a theme changes the colours and never the hierarchy (DESIGN.md, "Themes").

import type { Palette, Scheme } from './contract'
import { type Oklch, oklchToHex } from './oklch'
import { BUILTINS, FOR_SCHEME, type Theme, type ThemeChoice } from './theme'

/** The accent's chroma, and the selection's: constants, not inputs. */
export const ACCENT_CHROMA = 0.17
export const SELECTION_CHROMA = 0.06

/** Lightness of each themed token, light / dark. */
export const RUNGS = {
  sidebar: [0.9, 0.15],
  background: [0.99, 0.215],
  band: [0.948, 0.262],
  selected: [0.918, 0.3],
  rule: [0.895, 0.312],
  border: [0.6, 0.55],
  bar: [0.52, 0.68],
  muted: [0.475, 0.75],
  text: [0.22, 0.945],
  accent: [0.47, 0.75],
  // A primary button under the pointer: a step lighter, as `brightness(1.1)` was.
  'accent-hover': [0.505, 0.775],
  'on-accent': [0.99, 0.18],
} as const satisfies Record<string, readonly [number, number]>

type Fixed = { hue: number; chroma: number; l: readonly [number, number] }

const ROOT = { chroma: 0.13, l: [0.48, 0.78] } as const

/** Money and the kinds of account aren't themed. A spend has no colour, so money out has none. */
export const FIXED = {
  in: { hue: 150, chroma: 0.12, l: [0.47, 0.77] },
  error: { hue: 27, chroma: 0.16, l: [0.5, 0.74] },
  assets: { hue: 228, ...ROOT },
  liabilities: { hue: 52, ...ROOT },
  expenses: { hue: 308, ...ROOT },
  income: { hue: 150, ...ROOT },
} as const satisfies Record<string, Fixed>

/** The theme's tokens for its own scheme, each a `#rrggbb`. */
export function deriveTokens(theme: Theme): Palette {
  const { scheme, neutralHue, neutralChroma, accentHue } = theme
  const at = (rung: keyof typeof RUNGS) => RUNGS[rung][scheme === 'light' ? 0 : 1]
  const neutral = (rung: keyof typeof RUNGS, chroma = neutralChroma): Oklch => ({
    l: at(rung),
    c: chroma,
    h: neutralHue,
  })

  const colours: Record<string, Oklch> = {
    sidebar: neutral('sidebar'),
    // At 60% in light, so it reads off-white rather than cream.
    background: neutral('background', scheme === 'light' ? neutralChroma * 0.6 : neutralChroma),
    band: neutral('band'),
    selected: { l: at('selected'), c: SELECTION_CHROMA, h: accentHue },
    rule: neutral('rule'),
    border: neutral('border'),
    bar: neutral('bar', neutralChroma * 2),
    muted: neutral('muted'),
    text: neutral('text'),
    accent: { l: at('accent'), c: ACCENT_CHROMA, h: accentHue },
    'accent-hover': { l: at('accent-hover'), c: ACCENT_CHROMA, h: accentHue },
    'on-accent': neutral('on-accent', 0.005),
  }
  for (const [name, { hue, chroma, l }] of Object.entries(FIXED)) {
    colours[name] = { l: l[scheme === 'light' ? 0 : 1], c: chroma, h: hue }
  }
  // The selection's tint at a third over the background: a details card, lifted with its row.
  colours.card = mix(colours.background as Oklch, colours.selected as Oklch, 1 / 3)
  // A notice's surface: the error's tint, faint, so its words stay text on a near-background.
  colours.notice = mix(colours.background as Oklch, colours.error as Oklch, 0.07)

  return Object.fromEntries(
    Object.entries(colours).map(([name, colour]) => [`--color-${name}`, oklchToHex(colour)]),
  )
}

/** `t` of the way from `a` to `b`, in OKLab: the even way to lay one colour over another. */
function mix(a: Oklch, b: Oklch, t: number): Oklch {
  const lab = ({ l, c, h }: Oklch) => {
    const r = (h * Math.PI) / 180
    return [l, c * Math.cos(r), c * Math.sin(r)] as const
  }
  const [la, aa, ba] = lab(a)
  const [lb, ab, bb] = lab(b)
  const [l, x, y] = [la + (lb - la) * t, aa + (ab - aa) * t, ba + (bb - ba) * t]
  return { l, c: Math.hypot(x, y), h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 }
}

/** Both schemes from a light and a dark theme, as the contract checks them. */
export function schemesOf(light: Theme, dark: Theme): Record<Scheme, Palette> {
  return { light: deriveTokens(light), dark: deriveTokens(dark) }
}

/** The window's own background before the page paints: what the stylesheet will show. */
export function backgroundFor(choice: ThemeChoice, systemDark: boolean): string {
  const scheme = choice === 'system' ? (systemDark ? 'dark' : 'light') : BUILTINS[choice].scheme
  return deriveTokens(BUILTINS[FOR_SCHEME[scheme]])['--color-background'] as string
}
