import { describe, expect, test } from 'vitest'
import { type Ink, inkFailures, type Step, stepFailures, type Theme } from './contract'
import { contrastRatio, deltaL, oklchToHex } from './oklch'

/** A grey at OKLCH lightness `l`. */
const grey = (l: number) => oklchToHex({ l, c: 0, h: 0 })

const WHITE = '#ffffff'
const BLACK = '#000000'

/** One palette in light and another in dark, over the same two tokens. */
const theme = (light: [string, string], dark: [string, string]): Theme => ({
  light: { '--ink': light[0], '--ground': light[1] },
  dark: { '--ink': dark[0], '--ground': dark[1] },
})

describe('ink', () => {
  const text: Ink[] = [{ ink: '--ink', on: '--ground', kind: 'text' }]
  const graphic: Ink[] = [{ ink: '--ink', on: '--ground', kind: 'graphic' }]

  test('text that clears 4.5:1 on its surface in both schemes passes', () => {
    expect(inkFailures(theme(['#595959', WHITE], ['#a6a6a6', BLACK]), text)).toEqual([])
  })

  test('a failure names the scheme, the pair and how far short it is', () => {
    const light = theme(['#777777', WHITE], ['#a6a6a6', BLACK])
    expect(inkFailures(light, text)).toEqual([
      {
        scheme: 'light',
        ink: '--ink',
        on: '--ground',
        ratio: contrastRatio('#777777', WHITE),
        needs: 4.5,
      },
    ])
  })

  test('dark is held to the same rule by the same code', () => {
    const dark = theme(['#595959', WHITE], ['#3a3a3a', BLACK])
    expect(inkFailures(dark, text).map((f) => f.scheme)).toEqual(['dark'])
  })

  test('a graphic needs 3:1, not 4.5:1', () => {
    const edge = theme(['#8a8a8a', WHITE], ['#6b6b6b', BLACK])
    expect(inkFailures(edge, graphic)).toEqual([])
    expect(inkFailures(edge, text)).toHaveLength(2)
  })

  test('a graphic under 3:1 fails', () => {
    const faint = theme(['#b8b8b8', WHITE], ['#6b6b6b', BLACK])
    expect(inkFailures(faint, graphic)).toMatchObject([{ scheme: 'light', needs: 3 }])
  })

  test('a token a palette lacks is a mistake in the theme, not a failure', () => {
    const missing = { light: { '--ink': '#000000' }, dark: { '--ink': '#ffffff' } }
    expect(() => inkFailures(missing, text)).toThrow('--ground')
  })
})

describe('surfaces', () => {
  const steps: Step[] = [{ from: '--ground', to: '--ink' }]

  test('a step of at least ΔL 0.04 in both schemes, within 2x, passes', () => {
    expect(stepFailures(theme([grey(0.93), grey(1)], [grey(0.25), grey(0.19)]), steps)).toEqual([])
  })

  test('only the size of a step is compared, never its direction', () => {
    // The test above steps down in light and up in dark; this one steps down in both.
    const either = theme([grey(0.94), grey(1)], [grey(0.13), grey(0.19)])
    expect(stepFailures(either, steps)).toEqual([])
  })

  test('a flat step names the scheme, the pair and its size', () => {
    const [ink, ground] = [grey(0.97), grey(1)]
    const flat = theme([ink, ground], [grey(0.24), grey(0.19)])
    expect(stepFailures(flat, steps)).toEqual([
      {
        kind: 'flat',
        scheme: 'light',
        from: '--ground',
        to: '--ink',
        step: deltaL(ground, ink),
        needs: 0.04,
      },
    ])
  })

  test('steps more than 2x apart across the schemes fail, with both sizes', () => {
    const light = [grey(0.95), grey(1)] as [string, string]
    const dark = [grey(0.35), grey(0.19)] as [string, string]
    const failures = stepFailures(theme(light, dark), steps)

    expect(failures).toEqual([
      {
        kind: 'diverged',
        from: '--ground',
        to: '--ink',
        light: deltaL(...light),
        dark: deltaL(...dark),
        factor: deltaL(...dark) / deltaL(...light),
        allows: 2,
      },
    ])
  })

  test('a step that vanishes in one scheme is both flat and diverged', () => {
    const gone = theme([grey(1), grey(1)], [grey(0.25), grey(0.19)])
    expect(stepFailures(gone, steps).map((f) => f.kind)).toEqual(['flat', 'diverged'])
  })
})
