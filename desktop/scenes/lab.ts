// The theme lab's rules: a light and a dark theme's inputs on sliders, what the colour contract
// says of the two, and the built-ins' JSON they export as. No DOM here; `bench.ts` draws them.

import {
  type InkFailure,
  inkFailures,
  type Scheme,
  type StepFailure,
  stepFailures,
} from '../shared/theme/contract'
import { schemesOf } from '../shared/theme/derive'
import { BUILTINS, FOR_SCHEME, Theme } from '../shared/theme/theme'

/** The lab's two themes, light and dark: the built-ins until a slider moves. */
export type Lab = Readonly<Record<Scheme, Theme>>

export type Failure = InkFailure | StepFailure

export const SCHEME_LABELS: Record<Scheme, string> = { light: 'Light', dark: 'Dark' }

export const ALL_KEPT = 'Every pair keeps the contract.'

export const BUILT_IN_LAB: Lab = {
  light: BUILTINS[FOR_SCHEME.light],
  dark: BUILTINS[FOR_SCHEME.dark],
}

/** Every number a theme holds: a new one is a key here with no edit, and one not a number fails. */
export type SliderKey = Exclude<keyof Theme, 'name' | 'scheme'>

export type Slider = { key: SliderKey; label: string; min: number; max: number; step: number }

/** Each slider's min and max are its input's bounds in the schema. */
export const SLIDERS: readonly Slider[] = [
  sliderOf('neutralHue', 'Neutral hue', 1),
  sliderOf('neutralChroma', 'Neutral chroma', 0.001),
  sliderOf('accentHue', 'Accent hue', 1),
]

function sliderOf(key: SliderKey, label: string, step: number): Slider {
  const { minValue: min, maxValue: max } = Theme.shape[key]
  if (min === null || max === null) throw new Error(`Theme's ${key} has no bounds`)
  return { key, label, min, max, step }
}

/** The lab with one slider moved; a value the schema refuses leaves the lab as it was. */
export function moved(lab: Lab, scheme: Scheme, key: SliderKey, value: string): Lab {
  const theme = Theme.safeParse({ ...lab[scheme], [key]: Number.parseFloat(value) })
  return theme.success ? { ...lab, [scheme]: theme.data } : lab
}

export function failuresOf(lab: Lab): Failure[] {
  const schemes = schemesOf(lab.light, lab.dark)
  return [...inkFailures(schemes), ...stepFailures(schemes)]
}

/** Each failure in words, ink first; a failing figure is cut, never rounded up to its need. */
export function linesOf(failures: readonly Failure[]): string[] {
  if (failures.length === 0) return [ALL_KEPT]
  return failures.map((failure) => {
    if (!('problem' in failure)) {
      const { scheme, ink, on, ratio, needs } = failure
      return `${SCHEME_LABELS[scheme]}: ${ink} on ${on} is ${cut(ratio, 2)}:1, needs ${needs}:1`
    }
    if (failure.problem === 'flat') {
      const { scheme, from, to, step, needs } = failure
      return `${SCHEME_LABELS[scheme]}: ${to} on ${from} steps ${cut(step, 3)}, needs ${needs}`
    }
    const { from, to, light, dark, allows } = failure
    const steps = `light steps ${light.toFixed(3)}, dark ${dark.toFixed(3)}`
    return `${to} on ${from}: ${steps}, more than ${allows}× apart`
  })
}

/** `value` with exactly `places` decimals, rounded down in decimal rather than in binary. */
function cut(value: number, places: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    roundingMode: 'floor',
    useGrouping: false,
  }).format(value)
}
