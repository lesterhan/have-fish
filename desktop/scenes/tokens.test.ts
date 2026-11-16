// The bench's tokens. Some read tokens.css, so this runs on Node; `tsconfig.json` checks it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { groupsOf, tokensIn } from './tokens'

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

describe('groupsOf', () => {
  test("gives Type and Space each of tokens.css's tokens that start their names", () => {
    const named = groupsOf(tokensCss).map((group) => ({
      title: group.title,
      names: group.tokens.map((token) => token.name),
    }))
    expect(named).toEqual([
      {
        title: 'Type',
        names: [
          '--font',
          '--font-serif',
          '--font-figures',
          '--font-code',
          '--text-key',
          '--text-small',
          '--text-quiet',
          '--text-sentence',
          '--text-title',
          '--weight-regular',
          '--weight-label',
          '--weight-strong',
          '--line-height',
        ],
      },
      {
        title: 'Space',
        names: [
          '--space-1',
          '--space-2',
          '--space-3',
          '--space-4',
          '--space-5',
          '--space-6',
          '--space-7',
          '--space-8',
        ],
      },
    ])
  })

  test("gives each field tokens.css's value", () => {
    const fields = groupsOf(tokensCss).flatMap((group) => group.tokens)
    const names = fields.map((token) => token.name)
    expect(fields).not.toEqual([])
    expect(fields).toEqual(tokensIn(tokensCss).filter((token) => names.includes(token.name)))
  })

  test('gives no field to a token a density block declares', () => {
    const css =
      ":root {\n  --space-1: 4px;\n  --space-2: 8px;\n}\n[data-density='large'] {\n  --space-2: 10px;\n}"
    expect(groupsOf(css)).toEqual([
      { title: 'Type', tokens: [] },
      { title: 'Space', tokens: [{ name: '--space-1', value: '4px' }] },
    ])
  })

  test('takes a new token by its name, and none outside every group', () => {
    const css = ':root {\n  --space-1: 4px;\n  --space-9: 36px;\n  --radius-x: 2px;\n}'
    expect(groupsOf(css).find((group) => group.title === 'Space')?.tokens).toEqual([
      { name: '--space-1', value: '4px' },
      { name: '--space-9', value: '36px' },
    ])
  })
})
