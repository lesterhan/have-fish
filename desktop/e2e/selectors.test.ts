// The e2e suite finds elements by role, accessible name and text, never by a CSS class or by
// position, so a restyle can't break a test about behaviour.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/** Tags a selector might put a class on: `button.add`. */
const TAGS =
  'a|button|div|dd|details|dl|dt|form|h[1-6]|header|input|kbd|label|li|main|nav|ol|p|section|select|span|summary|ul'
/** A class in a selector: `.name` alone, after a space, `]` or `)`, or on a tag. */
const CLASS = new RegExp(`(?:^|[\\s\\])>+~,]|\\b(?:${TAGS}))\\.[a-zA-Z_][\\w-]*`)
/** Position, which a reordered layout changes. */
const POSITION = /:(?:nth-child|nth-last-child|nth-of-type|first-child|last-child|first-of-type)\b/
/** Strings that look like a class but are file names: `.woff2`, `sheet-main.ts`. */
const FILE = /^[\w-]*\.(?:woff2?|ttf|otf|css|js|ts|html|png)$/

const LITERAL = /'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g

/** Whether a string's selector text names a class or a position. */
function flagged(text: string): boolean {
  // What's inside `${…}` is code, not selector text.
  const selector = text.replace(/\$\{[^}]*\}/g, '')
  if (FILE.test(selector)) return false
  return CLASS.test(selector) || POSITION.test(selector)
}

/** Each string literal in the e2e files that names a class or a position, as `file:line text`. */
function offenders(dir: string): string[] {
  const found: string[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return
        for (const [literal] of line.matchAll(LITERAL)) {
          if (flagged(literal.slice(1, -1))) found.push(`${file}:${i + 1} ${literal}`)
        }
      })
  }
  return found
}

describe('e2e selectors', () => {
  test('none names a CSS class or a position', () => {
    expect(offenders(import.meta.dirname)).toEqual([])
  })

  test('the check catches what it says it does', () => {
    for (const bad of [
      'main.accounts button.add',
      'section .heading',
      '.total',
      'ol li:nth-child(2)',
      '[role=option] span:first-child',
      '[aria-hidden=true].bar',
    ]) {
      expect(flagged(bad), bad).toBe(true)
    }
    for (const fine of [
      'role=button[name="Add account"s]',
      'ol[aria-label=Ledger] li[aria-selected=true]',
      'https://example.com/',
      'spend.write',
      'No spending in this week.',
      'ol >> text=/^\\d+\\.\\d{2} CAD$/',
      'Lunch -> Sam',
      '.woff2',
      'sheet-main.ts',
    ]) {
      expect(flagged(fine), fine).toBe(false)
    }
  })
})
