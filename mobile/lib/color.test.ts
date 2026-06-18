/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import { darken, hexToRgb, lighten, alpha } from './color'

describe('hexToRgb', () => {
  it('parses #rrggbb', () => {
    expect(hexToRgb('#fcfbf8')).toEqual({ r: 252, g: 251, b: 248 })
  })

  it('expands #rgb shorthand', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('tolerates a missing hash', () => {
    expect(hexToRgb('2a2620')).toEqual({ r: 42, g: 38, b: 32 })
  })

  it('throws on a non-hex string', () => {
    expect(() => hexToRgb('rgb(1,2,3)')).toThrow()
    expect(() => hexToRgb('#12')).toThrow()
  })
})

describe('lighten', () => {
  it('returns the base at 0%', () => {
    expect(lighten('#c0651f', 0)).toBe('rgb(192, 101, 31)')
  })

  it('reaches white at 100%', () => {
    expect(lighten('#000000', 100)).toBe('rgb(255, 255, 255)')
  })

  it('moves channels partway toward white', () => {
    // #c0651f → +2% : each channel 2% of the way to 255
    expect(lighten('#c0651f', 2)).toBe('rgb(193, 104, 35)')
  })
})

describe('darken', () => {
  it('returns the base at 0%', () => {
    expect(darken('#c0651f', 0)).toBe('rgb(192, 101, 31)')
  })

  it('reaches black at 100%', () => {
    expect(darken('#ffffff', 100)).toBe('rgb(0, 0, 0)')
  })

  it('scales channels toward black', () => {
    // #fcfbf8 → −5% : each channel × 0.95
    expect(darken('#fcfbf8', 5)).toBe('rgb(239, 238, 236)')
  })
})

describe('alpha', () => {
  it('builds an rgba string from hex + alpha', () => {
    expect(alpha('#ffffff', 0.28)).toBe('rgba(255, 255, 255, 0.28)')
  })

  it('clamps alpha to [0,1]', () => {
    expect(alpha('#000000', 5)).toBe('rgba(0, 0, 0, 1)')
    expect(alpha('#000000', -1)).toBe('rgba(0, 0, 0, 0)')
  })
})
