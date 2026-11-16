// The theme lab's rules: a light and a dark theme's inputs on sliders, what the colour contract
// says of the two, and the built-ins' JSON they export as. No DOM here; `bench.ts` draws them.

import { Theme } from '../shared/theme/theme'

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
