// The colour contract every theme keeps, in light and in dark: ink is legible on the surface it
// sits on, and each surface is a real step from the one beneath it, about the same size in both
// schemes. Pure, so the tests and a theme being made call the same code. Each check returns the
// pairs that fail; the words for them are the caller's.

import { contrastRatio, deltaL } from './oklch'

export const SCHEMES = ['light', 'dark'] as const
export type Scheme = (typeof SCHEMES)[number]

/** A colour token's name to its `#rrggbb`. */
export type Palette = Readonly<Record<string, string>>
export type Theme = Readonly<Record<Scheme, Palette>>

/** WCAG 1.4.3 for text; 1.4.11 for a mark you need to see to use the screen. */
export const MIN_RATIO = { text: 4.5, graphic: 3 } as const

export type Ink = { ink: string; on: string; kind: keyof typeof MIN_RATIO }

/** `to` sits on `from`. */
export type Step = { from: string; to: string }

/** Below this, two surfaces read as one with a seam. */
export const MIN_STEP = 0.04

/** How far the schemes may disagree on a step's size: the dark end wants a little more. */
export const MAX_DIVERGENCE = 2

/** Every ink the window draws, on every surface it draws it on. */
export const INK: readonly Ink[] = [
  { ink: '--color-text', on: '--color-background', kind: 'text' },
  { ink: '--color-muted', on: '--color-background', kind: 'text' },
  { ink: '--color-error', on: '--color-background', kind: 'text' },
  // A selected row: its description, and its date.
  { ink: '--color-text', on: '--color-selected', kind: 'text' },
  { ink: '--color-muted', on: '--color-selected', kind: 'text' },
  // An input's or a button's edge.
  { ink: '--color-border', on: '--color-background', kind: 'graphic' },
]

/** Every surface, on the one beneath it. */
export const STEPS: readonly Step[] = [
  { from: '--color-background', to: '--color-selected' },
  { from: '--color-background', to: '--color-rule' },
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

export function inkFailures(theme: Theme, pairs: readonly Ink[] = INK): InkFailure[] {
  return SCHEMES.flatMap((scheme) =>
    pairs.flatMap(({ ink, on, kind }) => {
      const ratio = contrastRatio(colour(theme, scheme, ink), colour(theme, scheme, on))
      const needs = MIN_RATIO[kind]
      return ratio < needs ? [{ scheme, ink, on, ratio, needs }] : []
    }),
  )
}

export function stepFailures(theme: Theme, steps: readonly Step[] = STEPS): StepFailure[] {
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

function colour(theme: Theme, scheme: Scheme, token: string): string {
  const value = theme[scheme][token]
  if (value === undefined) throw new Error(`${token} is not in the ${scheme} palette`)
  return value
}
