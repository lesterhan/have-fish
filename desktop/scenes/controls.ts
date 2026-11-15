// The design bench's rules: what its controls say, read from and written to its own address, and
// the frames that shows. No DOM here; `bench.ts` draws them.

import { NARROW } from '../renderer/narrow'
import { DENSITIES, type Density } from '../shared/density'
import { deriveTokens } from '../shared/theme/derive'
import { BUILTINS, FOR_SCHEME, type Theme } from '../shared/theme/theme'
import { SCENES, type Scene, sceneNamed } from './scenes'

export const WIDTHS = ['full', 'narrow', 'minimum'] as const
export type Width = (typeof WIDTHS)[number]

/** The theme control's values: one scheme, or both side by side. */
export const SHOWN = ['light', 'dark', 'both'] as const
export type Shown = (typeof SHOWN)[number]

/** What the controls say. Only `benchOf` makes one, so each field is one of its list. */
export type Bench = { scene: string; density: Density; width: Width; shown: Shown }

export type Choice<V extends string> = { value: V; label: string }

export type Control = {
  [K in keyof Bench]: { key: K; label: string; choices: readonly Choice<Bench[K]>[] }
}[keyof Bench]

/** One frame of the bench: its page, the theme painted on it, and its width (null for a share). */
export type Frame = { src: string; theme: Theme; width: number | null }

/** DESIGN.md's row and base type, for the labels; the frame's own come from tokens.css. */
export const DENSITY_STEPS: Record<Density, { row: number; type: number }> = {
  compact: { row: 30, type: 13 },
  regular: { row: 33, type: 14 },
  comfortable: { row: 40, type: 14 },
  large: { row: 46, type: 16 },
}

/** Said whenever Both is chosen: the two frames share the bench's one focus. */
export const BOTH_NOTE =
  'Both shows one page twice, and a page has one focus: an open palette, picker or list shows in one frame only. Choose Light or Dark to see it open.'

export const DEFAULT_SCENE = 'ledger/year'

// The window's minWidth in main/window.ts, which the scenes may not import.
export const MINIMUM_WIDTH = 360

/** The bar's selects, in its order. */
export const CONTROLS: readonly Control[] = [
  {
    key: 'scene',
    label: 'Scene',
    choices: SCENES.map((scene) => ({ value: scene.name, label: scene.name })),
  },
  {
    key: 'density',
    label: 'Density',
    choices: DENSITIES.map((density) => ({ value: density, label: densityLabel(density) })),
  },
  {
    key: 'width',
    label: 'Width',
    choices: [
      { value: 'full', label: 'Full' },
      { value: 'narrow', label: 'Narrow, 44rem' },
      { value: 'minimum', label: 'Minimum, 360px' },
    ],
  },
  {
    key: 'shown',
    label: 'Theme',
    choices: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'both', label: 'Both' },
    ],
  },
]

/** The bench an address names, each field read alone: one it can't read is its default. */
export function benchOf(search: string): Bench {
  const asked = new URLSearchParams(search)
  const scene = sceneNamed(asked.get('scene')) ?? defaultScene()
  return {
    scene: scene.name,
    density: densityFor(scene, asked.get('density')) ?? 'regular',
    width: WIDTHS.find((w) => w === asked.get('width')) ?? 'full',
    shown: SHOWN.find((s) => s === asked.get('shown')) ?? 'light',
  }
}

function defaultScene(): Scene {
  const scene = sceneNamed(DEFAULT_SCENE)
  if (scene === null) throw new Error(`SCENES has no ${DEFAULT_SCENE}`)
  return scene
}

/** The address that names `bench`, so a reload shows the same view. */
export function searchOf({ scene, density, width, shown }: Bench): string {
  return `?${new URLSearchParams({ scene, density, width, shown })}`
}

export function densityLabel(density: Density): string {
  const { row, type } = DENSITY_STEPS[density]
  return `${density[0]?.toUpperCase()}${density.slice(1)} · ${row}px rows · ${type}px type`
}

/** A frame's content width in px; a media query's rem is the initial 16px. */
export function widthOf(width: Width): number | null {
  if (width === 'full') return null
  if (width === 'minimum') return MINIMUM_WIDTH
  return remOf(NARROW) * 16
}

/** The `<n>rem` a media query names. */
export function remOf(query: string): number {
  const rem = /(\d+(?:\.\d+)?)rem/.exec(query)?.[1]
  if (rem === undefined) throw new Error(`no rem in ${query}`)
  return Number.parseFloat(rem)
}

/** The frames the bench shows: one for light or dark, light then dark for both. */
export function framesOf(bench: Bench): Frame[] {
  const { scene, density } = bench
  const schemes = bench.shown === 'both' ? (['light', 'dark'] as const) : [bench.shown]
  return schemes.map((scheme) => ({
    src: `./?${new URLSearchParams({ scene, density })}`,
    theme: BUILTINS[FOR_SCHEME[scheme]],
    width: widthOf(bench.width),
  }))
}

/** What a frame's root is painted with: every colour token, and the scheme controls follow. */
export function rootStyleOf(theme: Theme): Record<string, string> {
  return { 'color-scheme': theme.scheme, ...deriveTokens(theme) }
}

/** What the bench says over its frames, if anything. */
export function noteOf(bench: Bench): string | null {
  return bench.shown === 'both' ? BOTH_NOTE : null
}

/** The density a scene opens at: the one asked for, else the scene's own. */
export function densityFor(scene: Scene, asked: string | null): Density | undefined {
  return DENSITIES.find((d) => d === asked) ?? scene.density
}
