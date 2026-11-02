import { describe, expect, it } from 'vitest'
import { rawColoursIn } from './colours'

describe('the detectors themselves', () => {
  it('catches a hex in a style block', () => {
    expect(rawColoursIn('.a { color: #8a5500; }')).toEqual(['#8a5500'])
  })

  it('catches a hex hidden in an inline style attribute', () => {
    // An inline style beats the class, so the token beneath it never shows.
    expect(rawColoursIn('<span style="background:#f0d8d8">CAD</span>')).toEqual(['#f0d8d8'])
  })

  it('catches a named colour', () => {
    expect(rawColoursIn('.a { background: white; }')).toEqual(['background: white'])
  })

  it('catches an rgb() that carries a hue', () => {
    expect(rawColoursIn('.a { color: rgb(200, 40, 40); }')).toEqual(['rgb(200, 40, 40)'])
  })

  it('leaves translucent neutrals alone — they are shadow and gloss, not colour', () => {
    expect(rawColoursIn('.a { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }')).toEqual([])
    expect(rawColoursIn('.a { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65); }')).toEqual([])
  })

  it('leaves a tint derived from a token alone', () => {
    expect(
      rawColoursIn(
        '.a { border-color: color-mix(in srgb, var(--color-warning) 30%, transparent); }',
      ),
    ).toEqual([])
  })

  it('leaves black and white alone when they are shading a token', () => {
    expect(
      rawColoursIn('.a { background: color-mix(in srgb, var(--color-accent) 80%, black); }'),
    ).toEqual([])
  })

  it('still catches black when it is the colour itself', () => {
    expect(rawColoursIn('.a { color: black; }')).toEqual(['color: black'])
  })

  it('does not read a comment as a declaration', () => {
    // A comment may quote the colour it is about.
    expect(
      rawColoursIn('/* it ran from #3b4252 down to #20242d */ .a { color: var(--x); }'),
    ).toEqual([])
  })
})
