import { describe, expect, it } from 'vitest'
import { isValidPath } from './account-path'

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
