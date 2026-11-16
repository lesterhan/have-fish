// The theme lab's rules: a light and a dark theme's inputs on sliders, what the colour contract
// says of the two, and the built-ins' JSON they export as. No DOM here; `bench.ts` draws them.

import {
  type InkFailure,
  inkFailures,
  SCHEMES,
  type Scheme,
  type StepFailure,
  stepFailures,
} from '../shared/theme/contract'
import { schemesOf } from '../shared/theme/derive'
import { BUILTINS, FOR_SCHEME, Theme } from '../shared/theme/theme'

/** The lab's two themes, light and dark: the built-ins until a slider moves. */
export type Lab = Readonly<Record<Scheme, Theme>>

export const BUILT_IN_LAB: Lab = {
  light: BUILTINS[FOR_SCHEME.light],
  dark: BUILTINS[FOR_SCHEME.dark],
}

/** Every number a theme holds: a new one joins with no edit, and a non-number fails to compile. */
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

export type Failure = InkFailure | StepFailure

/** The contract's own failures for the lab's two themes, ink first. */
export function failuresOf(lab: Lab): Failure[] {
  const schemes = schemesOf(lab.light, lab.dark)
  return [...inkFailures(schemes), ...stepFailures(schemes)]
}

export const SCHEME_LABELS: Record<Scheme, string> = { light: 'Light', dark: 'Dark' }

export const ALL_KEPT = 'Every pair keeps the contract.'

/** Each failure in words, in its order; a failing figure is cut, never rounded up to its need. */
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
    // The smaller cut and the larger rounded up, so the two never read closer than they are.
    const figure = (step: number) =>
      step < Math.max(light, dark) ? cut(step, 3) : roundedUp(step, 3)
    const steps = `light steps ${figure(light)}, dark ${figure(dark)}`
    return `${to} on ${from}: ${steps}, more than ${allows}× apart`
  })
}

/** `value` with exactly `places` decimals, rounded down in decimal rather than in binary. */
function cut(value: number, places: number): string {
  return written(value, places, 'floor')
}

/** `value` with exactly `places` decimals, rounded up in decimal. */
function roundedUp(value: number, places: number): string {
  return written(value, places, 'ceil')
}

function written(value: number, places: number, roundingMode: 'floor' | 'ceil'): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    roundingMode,
    useGrouping: false,
  }).format(value)
}

export type Exported = { file: string; text: string }

/** The two built-ins' JSON, as their files hold it, to paste over them. */
export function exportsOf(lab: Lab): Exported[] {
  return SCHEMES.map((scheme) => ({
    file: `shared/theme/builtins/${FOR_SCHEME[scheme]}.json`,
    text: `${JSON.stringify(lab[scheme], null, 2)}\n`,
  }))
}
