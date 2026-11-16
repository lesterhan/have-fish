// The bench's tokens. Some read tokens.css, so this runs on Node; `tsconfig.json` checks it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { deriveTokens } from '../shared/theme/derive'
import { BUILT_IN_LAB, moved } from './lab'
import { changedOf, exportOf, GRID_STYLE, groupsOf, styleOf, tokensIn } from './tokens'

const tokensCss = readFileSync(join(import.meta.dirname, '..', 'renderer', 'tokens.css'), 'utf8')
const fields = groupsOf(tokensCss).flatMap((group) => group.tokens)

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
    const names = fields.map((token) => token.name)
    expect(fields).not.toEqual([])
    expect(fields).toEqual(tokensIn(tokensCss).filter((token) => names.includes(token.name)))
  })

  test('gives no field to a token any density block declares', () => {
    const css =
      ":root {\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 12px;\n}\n[data-density='large'] {\n  --space-2: 10px;\n}\n[data-density='compact'] {\n  --space-3: 10px;\n}"
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

describe('changedOf', () => {
  test('finds nothing when nothing was typed', () => {
    expect(changedOf(fields, {})).toEqual([])
  })

  test('gives a field typed with a new value', () => {
    expect(changedOf(fields, { '--space-2': '10px' })).toEqual([
      { name: '--space-2', value: '10px' },
    ])
  })

  test('trims what was typed', () => {
    expect(changedOf(fields, { '--space-2': ' 10px ' })).toEqual([
      { name: '--space-2', value: '10px' },
    ])
  })

  test('finds no change in a field typed back to its own value, spaces aside', () => {
    expect(changedOf(fields, { '--space-2': ' 8px ' })).toEqual([])
  })

  test("reads an emptied field as the token's own value", () => {
    expect(changedOf(fields, { '--space-2': '' })).toEqual([])
  })

  test("keeps tokens.css's order, not the order typed", () => {
    const typed = { '--space-2': '10px', '--text-title': 'calc(var(--text-base) + 8px)' }
    expect(changedOf(fields, typed)).toEqual([
      { name: '--text-title', value: 'calc(var(--text-base) + 8px)' },
      { name: '--space-2', value: '10px' },
    ])
  })

  test("changes only a field's token", () => {
    expect(changedOf(fields, { '--text-base': '15px', '--row': '40px', '--nope': '1px' })).toEqual(
      [],
    )
  })
})

describe('styleOf', () => {
  test("sets a changed field's value and clears every other field", () => {
    const style = styleOf(fields, { '--space-2': '10px' })
    expect(Object.keys(style)).toEqual(fields.map((token) => token.name))
    expect(Object.keys(style)).toHaveLength(21)
    expect(Object.entries(style).filter(([, value]) => value !== '')).toEqual([
      ['--space-2', '10px'],
    ])
  })
})

describe('exportOf', () => {
  test('is empty when nothing changed', () => {
    expect(exportOf(fields, {}, BUILT_IN_LAB)).toBe('')
  })

  test("writes each token changed in the panel as a line, in tokens.css's order", () => {
    const typed = { '--space-2': '10px', '--text-title': 'calc(var(--text-base) + 8px)' }
    expect(exportOf(fields, typed, BUILT_IN_LAB)).toBe(
      '--text-title: calc(var(--text-base) + 8px);\n--space-2: 10px;',
    )
  })

  test('writes the light colours a moved hue changes, marked light', () => {
    const lab = moved(BUILT_IN_LAB, 'light', 'accentHue', '200')
    const painted = deriveTokens(lab.light)
    expect(exportOf(fields, {}, lab)).toBe(
      ['--color-selected', '--color-accent', '--color-accent-hover', '--color-card']
        .map((name) => `${name}: ${painted[name]}; /* light */`)
        .join('\n'),
    )
  })

  test('marks the dark colours dark', () => {
    const lab = moved(BUILT_IN_LAB, 'dark', 'neutralHue', '200')
    const lines = exportOf(fields, {}, lab).split('\n')
    expect(lines).toHaveLength(15)
    expect(lines.filter((line) => !line.endsWith(' /* dark */'))).toEqual([])
    expect(lines[0]).toBe(
      `--color-sidebar: ${deriveTokens(lab.dark)['--color-sidebar']}; /* dark */`,
    )
  })

  test("writes the panel's tokens, then light's colours, then dark's", () => {
    const lab = moved(moved(BUILT_IN_LAB, 'dark', 'neutralHue', '200'), 'light', 'accentHue', '200')
    const lines = exportOf(fields, { '--space-2': '10px' }, lab).split('\n')
    expect(lines).toHaveLength(20)
    expect(lines[0]).toBe('--space-2: 10px;')
    expect(lines.slice(1, 5).filter((line) => !line.endsWith(' /* light */'))).toEqual([])
    expect(lines.slice(5).filter((line) => !line.endsWith(' /* dark */'))).toEqual([])
  })

  test("is empty for a lab moved and moved back to the built-in's value", () => {
    const lab = moved(moved(BUILT_IN_LAB, 'light', 'accentHue', '200'), 'light', 'accentHue', '90')
    expect(lab).not.toBe(BUILT_IN_LAB)
    expect(exportOf(fields, {}, lab)).toBe('')
  })
})

describe('GRID_STYLE', () => {
  test("spaces its lines by the frame's own --space-1", () => {
    expect(GRID_STYLE['background-size']).toBe('var(--space-1) var(--space-1)')
  })

  test('takes no click and stays over the frame as it scrolls', () => {
    expect(GRID_STYLE['pointer-events']).toBe('none')
    expect(GRID_STYLE.position).toBe('fixed')
  })
})
