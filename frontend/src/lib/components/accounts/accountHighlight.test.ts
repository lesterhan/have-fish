import { describe, it, expect } from 'bun:test'
import { glyphs } from './accountHighlight'

/** Compact render: uppercase = matched, `·` = separator, `[]` = leaf segment. */
function render(path: string, pos: number[]): string {
  return glyphs(path, pos)
    .map((g) => (g.sep ? '·' : g.hl ? g.ch.toUpperCase() : g.ch))
    .join('')
}

function leafOf(path: string, pos: number[] = []): string {
  return glyphs(path, pos)
    .filter((g) => g.leaf)
    .map((g) => g.ch)
    .join('')
}

describe('glyphs', () => {
  it('marks the matched characters and nothing else', () => {
    // "wis" landing on the start of the `wise` segment.
    expect(render('assets:wise:cad', [7, 8, 9])).toBe('assets·WISe·cad')
  })

  it('marks separators as separators, never as content', () => {
    const g = glyphs('assets:wise:cad', [])
    expect(g.filter((x) => x.sep).map((x) => x.ch)).toEqual([':', ':'])
    expect(g.filter((x) => x.sep).every((x) => !x.leaf && !x.hl)).toBe(true)
  })

  it('treats the final segment as the leaf', () => {
    expect(leafOf('assets:wise:cad')).toBe('cad')
    expect(leafOf('assets')).toBe('assets')
  })

  it('does not mark a separator as matched even if the scorer named its index', () => {
    // Defensive: a separator is punctuation, so highlighting one would be noise.
    const g = glyphs('assets:wise', [6])
    expect(g[6]!.sep).toBe(true)
    expect(g[6]!.hl).toBe(false)
  })

  it('returns one glyph per character, so nothing is dropped', () => {
    const path = '储蓄:中国银行'
    expect(glyphs(path, []).length).toBe(path.length)
    expect(glyphs(path, []).map((g) => g.ch).join('')).toBe(path)
  })

  it('handles an empty path and an empty match', () => {
    expect(glyphs('', [])).toEqual([])
    expect(render('assets', [])).toBe('assets')
  })
})
