// A theme is a few inputs, never colours: `deriveTokens` places them on the ladder. The built-ins
// are JSON beside this file; the choice between them is the machine's (`main/machine.ts`).

import { z } from 'zod'
import graphiteDark from './builtins/graphite-dark.json'
import graphiteLight from './builtins/graphite-light.json'
import { SCHEMES } from './contract'

const hue = z.number().min(0).max(360)

/** Loose bounds: the contract, not the schema, says whether inputs make a legible theme. */
export const Theme = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]{1,40}$/),
  scheme: z.enum(SCHEMES),
  neutralHue: hue,
  neutralChroma: z.number().min(0).max(0.1),
  accentHue: hue,
})
export type Theme = z.infer<typeof Theme>

/** Parsed when loaded, so a built-in that stops fitting the schema fails the first test. */
export const BUILTINS = {
  'graphite-light': Theme.parse(graphiteLight),
  'graphite-dark': Theme.parse(graphiteDark),
} as const

export type BuiltinName = keyof typeof BUILTINS

/** What the person picks: a built-in, or following the system between the two below. */
export const THEME_CHOICES = ['system', 'graphite-light', 'graphite-dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

/** The built-in each scheme falls to when following the system, and what `tokens.css` holds. */
export const FOR_SCHEME = { light: 'graphite-light', dark: 'graphite-dark' } as const satisfies {
  [S in Theme['scheme']]: BuiltinName
}

/** A saved value read back: anything this version doesn't know follows the system. */
export function themeChoiceOf(saved: unknown): ThemeChoice {
  return THEME_CHOICES.find((c) => c === saved) ?? 'system'
}

/** Electron's `nativeTheme.themeSource` for a choice: the stylesheet does the rest. */
export function themeSourceOf(choice: ThemeChoice): 'system' | 'light' | 'dark' {
  return choice === 'system' ? 'system' : BUILTINS[choice].scheme
}
