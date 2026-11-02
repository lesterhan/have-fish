import { describe, expect, it } from 'vitest'
import { isValidPath, nameOf, pathFor } from './account-path'

describe('isValidPath', () => {
  it('accepts colon-separated segments', () => {
    for (const path of ['assets', 'assets:bank', '储蓄:中国银行', 'a b:c']) {
      expect(isValidPath(path)).toBe(true)
    }
  })

  it('refuses empty segments and surrounding whitespace', () => {
    for (const path of ['', ' ', ':x', 'x:', 'x::y', ' x', 'x ', 'x: y', 'x :y']) {
      expect(isValidPath(path)).toBe(false)
    }
  })
})

describe('pathFor and nameOf', () => {
  it('put the kind’s root before the name, and take it off again', () => {
    expect(pathFor('card', 'visa')).toBe('liabilities:visa')
    expect(pathFor('loan', 'car')).toBe('liabilities:car')
    expect(pathFor('bank', 'wise:cad')).toBe('assets:wise:cad')
    expect(nameOf('liabilities:visa')).toBe('visa')
    expect(nameOf('assets:wise:cad')).toBe('wise:cad')
  })

  it('a path with no root is all name', () => {
    expect(nameOf('assets')).toBe('assets')
  })
})
