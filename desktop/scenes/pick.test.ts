// The bench's pick. Some read tokens.css, so this runs on Node; `tsconfig.json` checks it.

import { describe, expect, test } from 'vitest'
import { matchedOf, partOf, partRun } from './pick'

describe('partOf', () => {
  test("names the file and line of Svelte's mark, without the column", () => {
    const meta = {
      parent: null,
      loc: { file: 'renderer/parts/Money.svelte', line: 29, column: 12 },
    }
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

describe('matchedOf', () => {
  test('gives only the rule whose selector matches', () => {
    const rules = [
      { cssText: '', selectorText: '.a', style: { cssText: 'color: var(--color-text);' } },
      { cssText: '', selectorText: '.b', style: { cssText: 'gap: var(--space-2);' } },
    ]
    expect(
      matchedOf(
        rules,
        (selector) => selector === '.a',
        () => true,
      ),
    ).toEqual(['color: var(--color-text);'])
  })

  test("keeps the sheet's order, never sorted", () => {
    const rules = [
      { cssText: '', selectorText: '.b', style: { cssText: 'gap: var(--space-2);' } },
      { cssText: '', selectorText: '.a', style: { cssText: 'color: var(--color-text);' } },
    ]
    expect(
      matchedOf(
        rules,
        () => true,
        () => true,
      ),
    ).toEqual(['gap: var(--space-2);', 'color: var(--color-text);'])
  })

  const media = [
    {
      cssText: '',
      conditionText: '(max-width: 44rem)',
      cssRules: [
        { cssText: '', selectorText: '.pane', style: { cssText: 'padding: var(--space-4);' } },
      ],
    },
  ]

  test('reads through a media rule that holds in the frame', () => {
    expect(
      matchedOf(
        media,
        () => true,
        (condition) => condition === '(max-width: 44rem)',
      ),
    ).toEqual(['padding: var(--space-4);'])
  })

  test("adds nothing from a media rule that doesn't hold in the frame", () => {
    expect(
      matchedOf(
        media,
        () => true,
        () => false,
      ),
    ).toEqual([])
  })

  test('reads through a grouping rule with no condition without asking holds', () => {
    const rules = [
      {
        cssText: '',
        cssRules: [{ cssText: '', selectorText: '.a', style: { cssText: 'gap: var(--space-1);' } }],
      },
    ]
    expect(
      matchedOf(
        rules,
        () => true,
        () => false,
      ),
    ).toEqual(['gap: var(--space-1);'])
  })

  test("never reads a style rule's nested rules", () => {
    const rules = [
      {
        cssText: '',
        selectorText: '.a',
        style: { cssText: 'gap: var(--space-1);' },
        cssRules: [
          {
            cssText: '',
            selectorText: '&:hover',
            style: { cssText: 'color: var(--color-accent);' },
          },
        ],
      },
    ]
    expect(
      matchedOf(
        rules,
        () => true,
        () => true,
      ),
    ).toEqual(['gap: var(--space-1);'])
  })

  test('reads no rule with a style and no selector, as @font-face', () => {
    expect(
      matchedOf(
        [{ cssText: '', style: { cssText: "font-family: 'X';" } }],
        () => true,
        () => true,
      ),
    ).toEqual([])
  })

  test('matches nothing on a selector matches refuses, and reads the rules after it', () => {
    const rules = [
      { cssText: '', selectorText: '', style: { cssText: 'margin: var(--space-8);' } },
      { cssText: '', selectorText: '.a', style: { cssText: 'gap: var(--space-1);' } },
    ]
    const matches = (selector: string) => {
      if (selector === '') throw new SyntaxError('empty')
      return true
    }
    expect(matchedOf(rules, matches, () => true)).toEqual(['gap: var(--space-1);'])
  })
})
