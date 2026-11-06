import { describe, expect, test } from 'vitest'
import { pathOf } from './path'

describe('a path', () => {
  test("each root's tag shows its initial, so colour never carries it alone", () => {
    expect(
      ['assets:cash', 'liabilities:visa', 'expenses:food', 'income:salary', 'equity:opening'].map(
        (p) => pathOf(p).tag,
      ),
    ).toEqual(['a', 'l', 'e', 'i', 'e'])
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
