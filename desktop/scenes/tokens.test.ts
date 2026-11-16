// The bench's tokens. Some read tokens.css, so this runs on Node; `tsconfig.json` checks it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { tokensIn } from './tokens'

const tokensCss = readFileSync(join(import.meta.dirname, '..', 'renderer', 'tokens.css'), 'utf8')

describe('tokensIn', () => {
  test("keeps the block's order, never sorted", () => {
    expect(tokensIn(':root {\n  --b: 2px;\n  --a: 1px;\n}')).toEqual([
      { name: '--b', value: '2px' },
      { name: '--a', value: '1px' },
    ])
  })

  test("splits nothing on a ';' or ':' in a comment, nor reads a :root in one", () => {
    const css = '/* :root { --z: 9px; } */\n:root {\n  /* a; b: c; */\n  --a: 1px;\n}'
    expect(tokensIn(css)).toEqual([{ name: '--a', value: '1px' }])
  })

  test("takes no property that isn't custom", () => {
    expect(tokensIn(':root {\n  color-scheme: light dark;\n  --a: 1px;\n}')).toEqual([
      { name: '--a', value: '1px' },
    ])
  })

  test('reads only the first :root', () => {
    const css =
      ':root {\n  --a: 1px;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --b: 2px;\n  }\n}\n:root {\n  --c: 3px;\n}'
    expect(tokensIn(css)).toEqual([{ name: '--a', value: '1px' }])
  })

  test('makes a value over several lines one line', () => {
    const css = ':root {\n  --ring:\n    inset 1px 0 0 red,\n    inset 0 1px 0 red;\n}'
    expect(tokensIn(css)).toEqual([
      { name: '--ring', value: 'inset 1px 0 0 red, inset 0 1px 0 red' },
    ])
  })

  test('reads every token of tokens.css but the colours', () => {
    const tokens = tokensIn(tokensCss)
    expect(tokens).toHaveLength(48)
    expect(tokens[0]).toEqual({
      name: '--font',
      value: "'IBM Plex Sans Variable', system-ui, sans-serif",
    })
    expect(tokens.at(-1)).toEqual({ name: '--duration-land', value: '2.4s' })
    expect(tokens).toContainEqual({ name: '--text-key', value: 'calc(var(--text-base) - 3px)' })
    expect(tokens.filter((token) => token.name.startsWith('--color-'))).toEqual([])
  })
})
