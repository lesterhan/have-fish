/**
 * The colour maths the design system is specified in.
 *
 * Worth its own tests because two of its properties are load-bearing and neither is obvious
 * from reading the conversion matrices: that OKLCH lightness is perceptually uniform where a
 * contrast ratio is not, and that asking for an out-of-gamut colour gives you back the same
 * hue at a lower chroma rather than a different hue.
 */

import { describe, it, expect } from 'bun:test'
import {
  contrastRatio,
  deltaL,
  hexToOklch,
  luminance,
  oklchToHex,
} from './oklch'

describe('conversion', () => {
  it('puts lightness on the 0-1 scale everyone quotes it on', () => {
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 3)
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3)
  })

  it('reports a grey as having no chroma', () => {
    expect(hexToOklch('#808080').c).toBeCloseTo(0, 3)
  })

  it('round-trips a colour through both directions', () => {
    for (const hex of ['#2d6ca8', '#c1bdb4', '#be222a', '#191710']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex)
    }
  })

  it('rejects anything that is not a six-digit hex', () => {
    expect(() => hexToOklch('#fff')).toThrow()
    expect(() => hexToOklch('rebeccapurple')).toThrow()
  })
})

describe('gamut mapping', () => {
  // sRGB cannot show a chroma of 0.4 at any hue, so every one of these is out of gamut and
  // has to come back reduced.
  const IMPOSSIBLE = { l: 0.52, c: 0.4, h: 150 }

  it('holds the hue when it cannot hold the chroma', () => {
    // The reason `oklchToHex` binary-searches instead of clamping the three channels: clamping
    // moves them by different amounts, so it slides the hue. Every accent is defined as "this
    // hue at this rung", and a hue that drifts when the chroma is unreachable makes that
    // definition a suggestion.
    const mapped = hexToOklch(oklchToHex(IMPOSSIBLE))
    expect(mapped.h).toBeCloseTo(IMPOSSIBLE.h, 0)
    expect(mapped.l).toBeCloseTo(IMPOSSIBLE.l, 1)
    expect(mapped.c).toBeLessThan(IMPOSSIBLE.c)
  })

  it('leaves a colour that fits exactly where it was asked for', () => {
    const reachable = { l: 0.52, c: 0.05, h: 150 }
    const mapped = hexToOklch(oklchToHex(reachable))
    expect(mapped.c).toBeCloseTo(reachable.c, 2)
  })

  it('returns a colour, not a clipped mess, at the ends of the ramp', () => {
    expect(oklchToHex({ l: 0, c: 0.1, h: 250 })).toBe('#000000')
    expect(oklchToHex({ l: 1, c: 0.1, h: 250 })).toBe('#ffffff')
  })
})

describe('the two contrast measures disagree, which is the point', () => {
  it('agrees with the ratios everyone knows by heart', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('does not care which way round the pair is given', () => {
    expect(contrastRatio('#191710', '#8a867d')).toBeCloseTo(
      contrastRatio('#8a867d', '#191710'),
      10,
    )
  })

  it('shows why a ratio cannot be the unit of a surface ladder', () => {
    // Both pairs measure 1.20:1. They are not the same step — near black it takes ΔL 0.070 to
    // buy what ΔL 0.042 buys in the mid-tones, so a ladder specified in ratios hands the dark
    // end shallower steps than were asked for. That is how the old dark theme flattened while
    // every value in it still "passed".
    const midTones = ['#4b473f', '#56534a'] as const
    const nearBlack = ['#19160f', '#2a261f'] as const

    expect(contrastRatio(...midTones)).toBeCloseTo(1.2, 2)
    expect(contrastRatio(...nearBlack)).toBeCloseTo(1.2, 2)
    expect(deltaL(...nearBlack) / deltaL(...midTones)).toBeGreaterThan(1.5)
  })
})
