import { describe, expect, it } from 'vitest'
import { madeColoursIn, rawColoursIn } from './colours'

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

describe('a colour made in a component', () => {
  it('catches text drawn at an opacity', () => {
    expect(madeColoursIn('kbd { font-size: 11px; opacity: 0.8; }')).toEqual(['opacity: 0.8'])
  })

  it('catches a filter that changes a colour', () => {
    expect(madeColoursIn('.primary:hover { filter: brightness(1.1); }')).toEqual([
      'filter: brightness(1.1)',
    ])
  })

  it('catches a surface or an ink mixed from tokens', () => {
    const mixed = 'color-mix(in oklab, var(--color-error) 7%, var(--color-background))'
    expect(madeColoursIn(`.notice { background: ${mixed}; }`)).toEqual([`background: ${mixed}`])
    expect(
      madeColoursIn('.a { color: color-mix(in oklab, currentColor 60%, transparent); }'),
    ).toEqual(['color: color-mix(in oklab, currentColor 60%, transparent)'])
  })

  it('catches one in an inline style', () => {
    expect(madeColoursIn('<span style="opacity: 0.6">CAD</span>')).toEqual(['opacity: 0.6'])
  })

  it("leaves an edge tinted from a token alone: it frames the words, it isn't them", () => {
    expect(
      madeColoursIn(
        'kbd { border: 1px solid color-mix(in oklab, currentColor 35%, transparent); }',
      ),
    ).toEqual([])
  })

  it('leaves the list that steps back while a row is open, which is not for reading', () => {
    const css = ':global([data-opened] > ol) > li:not(.open) { opacity: 0.5; }'
    expect(madeColoursIn(css)).toEqual([])
    expect(madeColoursIn('[data-opened] > .stays { opacity: 0.5; }')).toEqual([])
    expect(madeColoursIn('li:not(.open) { opacity: 0.5; }')).toEqual(['opacity: 0.5'])
  })

  it("leaves a disabled control alone, which WCAG doesn't hold to a contrast", () => {
    const css = "button:disabled,\nbutton[aria-disabled='true'] { opacity: 0.5; }"
    expect(madeColoursIn(css)).toEqual([])
  })

  it('leaves fully shown, fully hidden and no filter alone', () => {
    expect(madeColoursIn('.a { opacity: 1; } .b { opacity: 0; } .c { filter: none; }')).toEqual([])
  })

  it('ignores comments', () => {
    expect(madeColoursIn('/* was opacity: 0.8 */ .a { color: var(--color-text); }')).toEqual([])
  })
})
