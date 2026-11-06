import { describe, expect, it } from 'vitest'
import { kbdsIn, lookIn, otherWidthsIn } from './layout'

describe('kbdsIn', () => {
  it('counts each keycap in markup', () => {
    expect(kbdsIn('<span>Amount <kbd aria-hidden="true">Ctrl+N</kbd></span><kbd>S</kbd>')).toBe(2)
  })

  it('ignores one in a comment', () => {
    expect(kbdsIn('<!-- <kbd>x</kbd> -->')).toBe(0)
  })
})

describe('otherWidthsIn', () => {
  it('passes the narrow width, max or min', () => {
    expect(otherWidthsIn('@media (max-width: 44rem) {} @media not (min-width: 44rem) {}')).toEqual(
      [],
    )
  })

  it('catches any other', () => {
    expect(otherWidthsIn('@media (max-width: 40rem) {}')).toEqual(['40rem'])
    expect(otherWidthsIn("matchMedia('(min-width: 600px)')")).toEqual(['600px'])
  })
})

describe('lookIn', () => {
  it('passes a style of grid, widths, gaps and order', () => {
    const style = `<style>
  main { display: grid; grid-template-columns: 1fr 2fr; gap: var(--space-4); }
  main[hidden] { display: none; }
  @media (max-width: 44rem) { .side { order: 2; inline-size: 100%; } }
</style>`
    expect(lookIn(style)).toEqual([])
  })

  it('catches colour, type, borders and the rest', () => {
    const style = `<style>
  main { display: grid; color: var(--color-text); border: 1px solid; font-size: var(--text-base); }
</style>`
    expect(lookIn(style)).toEqual(['color', 'border', 'font-size'])
  })

  it('reads no further than the style block', () => {
    expect(lookIn('<p style="color: red">x</p>')).toEqual([])
  })
})
