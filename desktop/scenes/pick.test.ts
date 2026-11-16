// The bench's pick. Some read tokens.css, so this runs on Node; `tsconfig.json` checks it.

import { describe, expect, test } from 'vitest'
import { partOf, partRun } from './pick'

describe('partOf', () => {
  test("names the file and line of Svelte's mark, without the column", () => {
    const meta = { parent: null, loc: { file: 'renderer/parts/Money.svelte', line: 29, column: 12 } }
    expect(partOf(meta)).toEqual({ file: 'renderer/parts/Money.svelte', line: 29 })
  })

  test('names nothing with no mark, null in dev or undefined in a build', () => {
    expect(partOf(null)).toBeNull()
    expect(partOf(undefined)).toBeNull()
  })

  test('names nothing from a mark without a string file and a number line', () => {
    expect(partOf({ loc: { file: 'renderer/parts/Money.svelte' } })).toBeNull()
    expect(partOf({ loc: { file: 7, line: 29 } })).toBeNull()
  })
})

describe('partRun', () => {
  const money29 = { loc: { file: 'renderer/parts/Money.svelte', line: 29, column: 12 } }
  const money24 = { loc: { file: 'renderer/parts/Money.svelte', line: 24, column: 12 } }
  const list = { loc: { file: 'renderer/ledger/SpendList.svelte', line: 242, column: 6 } }
  const row = { loc: { file: 'renderer/parts/Row.svelte', line: 72, column: 0 } }

  test('counts the leading run of marks in one file, not the same part further up', () => {
    expect(partRun([money29, money24, list, row, money24])).toBe(2)
  })

  test('is 1 for an element no part marked, though its parent is marked', () => {
    expect(partRun([null, money24])).toBe(1)
  })
})
