import { describe, expect, test } from 'vitest'
import { pathOf } from './path'

describe('a path', () => {
  test("each root's tag is its own, so colour never carries it alone", () => {
    const tags = ['assets:cash', 'liabilities:visa', 'expenses:food', 'income:salary'].map(
      (p) => pathOf(p).tag,
    )
    expect(tags).toEqual(['a', 'l', 'e', 'i'])
    // Equity's initial is expenses' already: it takes the next letter of its word.
    expect(pathOf('equity:opening').tag).toBe('q')
    expect(new Set([...tags, pathOf('equity:opening').tag]).size).toBe(5)
  })

  test('a root the ledger has no word for shows its initial', () => {
    expect(pathOf('other:thing').tag).toBe('o')
  })

  test("drops its root's word: the tag stands for it", () => {
    expect(pathOf('liabilities:cibc:visa')).toEqual({
      root: 'liabilities',
      tag: 'l',
      parents: ['cibc'],
      leaf: 'visa',
    })
    expect(pathOf('assets:wallet')).toMatchObject({ parents: [], leaf: 'wallet' })
  })

  test('keeps every parent, in order', () => {
    expect(pathOf('expenses:food:out:lunch')).toMatchObject({
      parents: ['food', 'out'],
      leaf: 'lunch',
    })
  })
})
