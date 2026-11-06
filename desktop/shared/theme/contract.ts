// The colour contract every theme keeps, in light and in dark: ink is legible on the surface it
// sits on, and each surface is a real step from the one beneath it, about the same size in both
// schemes. Pure, so the tests and a theme being made call the same code. Each check returns the
// pairs that fail; the words for them are the caller's.

import { contrastRatio, deltaL } from './oklch'

export const SCHEMES = ['light', 'dark'] as const
export type Scheme = (typeof SCHEMES)[number]

/** A colour token's name to its `#rrggbb`. */
export type Palette = Readonly<Record<string, string>>
export type Schemes = Readonly<Record<Scheme, Palette>>

/** WCAG 1.4.3 for text; 1.4.11 for a mark you need to see to use the screen. */
export const MIN_RATIO = { text: 4.5, graphic: 3 } as const

export type Ink = { ink: string; on: string; kind: keyof typeof MIN_RATIO }

/** `to` sits on `from`. */
export type Step = { from: string; to: string }

/** Below this, two surfaces read as one with a seam. */
export const MIN_STEP = 0.04

/** How far the schemes may disagree on a step's size: the dark end wants a little more. */
export const MAX_DIVERGENCE = 2

/** The surfaces the window reads from, each holding every ink below. */
export const SURFACES = [
  '--color-background',
  '--color-sidebar',
  '--color-band',
  '--color-selected',
] as const

/** Text: words, figures, the money-in colour, the accent, and each root's tag. */
const ON_EVERY_SURFACE = [
  '--color-text',
  '--color-muted',
  '--color-accent',
  '--color-in',
  '--color-assets',
  '--color-liabilities',
  '--color-expenses',
  '--color-income',
] as const

/** Every ink the window draws, on every surface it draws it on. */
export const INK: readonly Ink[] = [
  ...SURFACES.flatMap((on) => ON_EVERY_SURFACE.map((ink): Ink => ({ ink, on, kind: 'text' }))),
  { ink: '--color-error', on: '--color-background', kind: 'text' },
  // A primary button's words, and its keycap, at rest and under the pointer.
  { ink: '--color-on-accent', on: '--color-accent', kind: 'text' },
  { ink: '--color-on-accent', on: '--color-accent-hover', kind: 'text' },
  // A notice: its words, its ✕, its edge, and a focus ring on it.
  { ink: '--color-text', on: '--color-notice', kind: 'text' },
  { ink: '--color-muted', on: '--color-notice', kind: 'text' },
  { ink: '--color-error', on: '--color-notice', kind: 'graphic' },
  { ink: '--color-accent', on: '--color-notice', kind: 'graphic' },
  // An input's edge.
  { ink: '--color-border', on: '--color-background', kind: 'graphic' },
  // A bar, and the accent's edge, on the line under a row.
  { ink: '--color-bar', on: '--color-rule', kind: 'graphic' },
  { ink: '--color-accent', on: '--color-rule', kind: 'graphic' },
]

/** Every surface, on the one beneath it. */
export const STEPS: readonly Step[] = [
  { from: '--color-background', to: '--color-selected' },
  { from: '--color-background', to: '--color-rule' },
  { from: '--color-background', to: '--color-band' },
  { from: '--color-background', to: '--color-sidebar' },
]

export type InkFailure = { scheme: Scheme; ink: string; on: string; ratio: number; needs: number }

export type StepFailure =
  | { kind: 'flat'; scheme: Scheme; from: string; to: string; step: number; needs: number }
  | {
      kind: 'diverged'
      from: string
      to: string
      light: number
      dark: number
      factor: number
      allows: number
    }

export function inkFailures(theme: Schemes, pairs: readonly Ink[] = INK): InkFailure[] {
  return SCHEMES.flatMap((scheme) =>
    pairs.flatMap(({ ink, on, kind }) => {
      const ratio = contrastRatio(colour(theme, scheme, ink), colour(theme, scheme, on))
      const needs = MIN_RATIO[kind]
      return ratio < needs ? [{ scheme, ink, on, ratio, needs }] : []
    }),
  )
}

export function stepFailures(theme: Schemes, steps: readonly Step[] = STEPS): StepFailure[] {
  return steps.flatMap(({ from, to }): StepFailure[] => {
    const size = (scheme: Scheme) => deltaL(colour(theme, scheme, from), colour(theme, scheme, to))
    const [light, dark] = [size('light'), size('dark')]

    const flat = SCHEMES.flatMap((scheme): StepFailure[] => {
      const step = size(scheme)
      return step < MIN_STEP ? [{ kind: 'flat', scheme, from, to, step, needs: MIN_STEP }] : []
    })

    const factor = Math.max(light, dark) / Math.min(light, dark)
    const diverged: StepFailure[] =
      factor > MAX_DIVERGENCE
        ? [{ kind: 'diverged', from, to, light, dark, factor, allows: MAX_DIVERGENCE }]
        : []

    return [...flat, ...diverged]
  })
}

function colour(theme: Schemes, scheme: Scheme, token: string): string {
  const value = theme[scheme][token]
  if (value === undefined) throw new Error(`${token} is not in the ${scheme} palette`)
  return value
}
