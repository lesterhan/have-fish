// The theme lab's rules. Some read the built-ins' files, so this runs on Node; `tsconfig.json`
// checks it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { inkFailures, stepFailures } from '../shared/theme/contract'
import { schemesOf } from '../shared/theme/derive'
import { BUILTINS, Theme } from '../shared/theme/theme'
import {
  ALL_KEPT,
  BUILT_IN_LAB,
  exportsOf,
  type Failure,
  failuresOf,
  type Lab,
  linesOf,
  moved,
  SLIDERS,
} from './lab'

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

describe('linesOf', () => {
  const flat: Failure = {
    problem: 'flat',
    scheme: 'dark',
    from: '--color-background',
    to: '--color-band',
    step: 0.031,
    needs: 0.04,
  }
  const border: Failure = {
    scheme: 'dark',
    ink: '--color-border',
    on: '--color-card',
    ratio: 2.5,
    needs: 3,
  }

  test('says every pair keeps the contract when nothing fails', () => {
    expect(linesOf([])).toEqual([ALL_KEPT])
    expect(ALL_KEPT).toBe('Every pair keeps the contract.')
  })

  test("names an ink failure's scheme, pair, ratio and need", () => {
    expect(
      linesOf([
        {
          scheme: 'light',
          ink: '--color-income',
          on: '--color-sidebar',
          ratio: 4.450078147348687,
          needs: 4.5,
        },
        border,
      ]),
    ).toEqual([
      'Light: --color-income on --color-sidebar is 4.45:1, needs 4.5:1',
      'Dark: --color-border on --color-card is 2.50:1, needs 3:1',
    ])
  })

  test("names a flat step's scheme, pair, step and need", () => {
    expect(linesOf([flat])).toEqual([
      'Dark: --color-band on --color-background steps 0.031, needs 0.04',
    ])
  })

  test("names a diverged step's pair and both its steps", () => {
    const diverged: Failure = {
      problem: 'diverged',
      from: '--color-background',
      to: '--color-band',
      light: 0.042,
      dark: 0.1,
      factor: 2.380952,
      allows: 2,
    }
    expect(linesOf([diverged])).toEqual([
      '--color-band on --color-background: light steps 0.042, dark 0.100, more than 2× apart',
    ])
  })

  test('cuts the smaller diverged step and rounds the larger up', () => {
    const diverged: Failure = {
      problem: 'diverged',
      from: '--color-background',
      to: '--color-band',
      light: 0.04251,
      dark: 0.08549,
      factor: 2.011056,
      allows: 2,
    }
    const mirrored: Failure = { ...diverged, light: 0.08549, dark: 0.04251 }
    expect(linesOf([diverged, mirrored])).toEqual([
      '--color-band on --color-background: light steps 0.042, dark 0.086, more than 2× apart',
      '--color-band on --color-background: light steps 0.086, dark 0.042, more than 2× apart',
    ])
  })

  test('keeps the order it is given', () => {
    expect(linesOf([flat, border])).toEqual([
      'Dark: --color-band on --color-background steps 0.031, needs 0.04',
      'Dark: --color-border on --color-card is 2.50:1, needs 3:1',
    ])
  })

  test('cuts a failing figure, never rounding it up to its need', () => {
    expect(
      linesOf([
        { scheme: 'light', ink: '--color-muted', on: '--color-band', ratio: 4.4999, needs: 4.5 },
        {
          problem: 'flat',
          scheme: 'light',
          from: '--color-background',
          to: '--color-band',
          step: 0.0399,
          needs: 0.04,
        },
      ]),
    ).toEqual([
      'Light: --color-muted on --color-band is 4.49:1, needs 4.5:1',
      'Light: --color-band on --color-background steps 0.039, needs 0.04',
    ])
  })

  test('cuts in decimal, so an exact figure keeps its last place', () => {
    expect(
      linesOf([
        { scheme: 'light', ink: '--color-in', on: '--color-card', ratio: 4.35, needs: 4.5 },
      ]),
    ).toEqual(['Light: --color-in on --color-card is 4.35:1, needs 4.5:1'])
  })
})

describe('exportsOf', () => {
  test("names the built-ins' two files, light then dark", () => {
    expect(exportsOf(BUILT_IN_LAB).map(({ file }) => file)).toEqual([
      'shared/theme/builtins/graphite-light.json',
      'shared/theme/builtins/graphite-dark.json',
    ])
  })

  test('writes an unmoved lab as the files hold it, byte for byte', () => {
    for (const { file, text } of exportsOf(BUILT_IN_LAB)) {
      expect(text, file).toBe(readFileSync(join(import.meta.dirname, '..', file), 'utf8'))
    }
  })

  test('reads back as the themes the lab paints', () => {
    const lab: Lab = {
      light: { ...BUILT_IN_LAB.light, neutralHue: 200, neutralChroma: 0.03, accentHue: 300 },
      dark: { ...BUILT_IN_LAB.dark, accentHue: 120 },
    }
    const exported = exportsOf(lab)
    expect(Theme.parse(JSON.parse(exported[0]?.text ?? ''))).toEqual(lab.light)
    expect(Theme.parse(JSON.parse(exported[1]?.text ?? ''))).toEqual(lab.dark)
  })
})
