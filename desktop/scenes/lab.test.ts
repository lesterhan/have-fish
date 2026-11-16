// The theme lab's rules. Some read the built-ins' files, so this runs on Node; `tsconfig.json`
// checks it.

import { describe, expect, test } from 'vitest'
import { inkFailures, stepFailures } from '../shared/theme/contract'
import { schemesOf } from '../shared/theme/derive'
import { BUILTINS, Theme } from '../shared/theme/theme'
import { BUILT_IN_LAB, failuresOf, type Lab, moved, SLIDERS } from './lab'

describe('SLIDERS', () => {
  test("are Theme's numbers, in its order", () => {
    const numbers = Object.entries(Theme.shape)
      .filter(([, schema]) => schema.type === 'number')
      .map(([key]) => key)
    expect(numbers).toEqual(['neutralHue', 'neutralChroma', 'accentHue'])
    expect(SLIDERS.map((slider) => slider.key)).toEqual(numbers)
  })

  test("run over each number's bounds in the schema, in their own steps", () => {
    expect(SLIDERS.map(({ key, min, max, step }) => ({ key, min, max, step }))).toEqual([
      { key: 'neutralHue', min: 0, max: 360, step: 1 },
      { key: 'neutralChroma', min: 0, max: 0.1, step: 0.001 },
      { key: 'accentHue', min: 0, max: 360, step: 1 },
    ])
  })

  test('say what each one moves', () => {
    expect(SLIDERS.map((slider) => slider.label)).toEqual([
      'Neutral hue',
      'Neutral chroma',
      'Accent hue',
    ])
  })

  test("stand on each built-in's value", () => {
    for (const theme of Object.values(BUILTINS)) {
      for (const { key, min, step } of SLIDERS) {
        const steps = (theme[key] - min) / step
        expect(Math.abs(steps - Math.round(steps)), `${theme.name} ${key}`).toBeLessThan(1e-9)
      }
    }
  })
})

describe('moved', () => {
  test('sets one input of one scheme', () => {
    expect(moved(BUILT_IN_LAB, 'dark', 'accentHue', '200')).toEqual({
      light: BUILT_IN_LAB.light,
      dark: { ...BUILT_IN_LAB.dark, accentHue: 200 },
    })
  })

  test('takes each end of a slider', () => {
    expect(moved(BUILT_IN_LAB, 'light', 'neutralHue', '0').light.neutralHue).toBe(0)
    expect(moved(BUILT_IN_LAB, 'light', 'neutralHue', '360').light.neutralHue).toBe(360)
    expect(moved(BUILT_IN_LAB, 'light', 'neutralChroma', '0.1').light.neutralChroma).toBe(0.1)
  })

  test('leaves the lab as it was past either end or for no number', () => {
    for (const value of ['-1', '361', 'abc']) {
      expect(moved(BUILT_IN_LAB, 'light', 'neutralHue', value), value).toBe(BUILT_IN_LAB)
    }
    expect(moved(BUILT_IN_LAB, 'light', 'neutralChroma', '0.101')).toBe(BUILT_IN_LAB)
  })
})

describe('failuresOf', () => {
  test("is the contract's own failures for the lab's two themes, ink first", () => {
    const lab: Lab = {
      light: { ...BUILT_IN_LAB.light, neutralHue: 350, neutralChroma: 0.1, accentHue: 355 },
      dark: BUILT_IN_LAB.dark,
    }
    const s = schemesOf(lab.light, lab.dark)
    const contract = [...inkFailures(s), ...stepFailures(s)]
    expect(contract).toHaveLength(1)
    expect(failuresOf(lab)).toEqual(contract)
  })
})
