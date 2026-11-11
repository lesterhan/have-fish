// The e2e suite reads where the cursor is through the readers in `app.ts`, and waits for it to
// land: a check that looks once passes on a fast machine and fails on a slow runner, with nothing
// wrong in the app.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/** The e2e files that drive the app, as [name, source]; app.ts holds the readers, so it is out. */
function drivers(): [string, string][] {
  return readdirSync(import.meta.dirname)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'app.ts')
    .map((file) => [file, readFileSync(join(import.meta.dirname, file), 'utf8')])
}

/** The lines of `source` that read `document.activeElement`, 1-based. */
function readsCursor(source: string): number[] {
  return source.split('\n').flatMap((line, i) => (line.includes('activeElement') ? [i + 1] : []))
}

/** An `expect(` that awaits a focus reader with no poll: it looks where the cursor is once. */
const LOOKS_ONCE = /expect\(\s*await\s+focused/g

/** The lines where an `expect(` looks at the cursor once, 1-based, at the line it opens. */
function looksOnce(source: string): number[] {
  return [...source.matchAll(LOOKS_ONCE)].map((match) => lineAt(source, match.index))
}

/** The 1-based line `at` falls on. */
function lineAt(source: string, at: number): number {
  return source.slice(0, at).split('\n').length
}

describe('the e2e suite and the cursor', () => {
  test('no file but app.ts reads the cursor', () => {
    const reads = drivers().flatMap(([file, source]) =>
      readsCursor(source).map((line) => `${file}:${line}`),
    )
    expect(reads).toEqual([])
  })

  test('no file looks for the cursor once', () => {
    const once = drivers().flatMap(([file, source]) =>
      looksOnce(source).map((line) => `${file}:${line}`),
    )
    expect(once).toEqual([])
  })

  test('no file keeps a reader of its own', () => {
    expect(
      drivers()
        .filter(([, source]) => source.includes('const focused'))
        .map(([file]) => file),
    ).toEqual([])
  })

  test('an expect that awaits a reader is found on its line', () => {
    expect(looksOnce("expect(await focusedName(page)).toBe('amount')")).toEqual([1])
  })

  test('one formatted across lines is found where the expect opens', () => {
    expect(looksOnce("expect(\n  await focusedIn(page),\n).toBe('Ledger OL')")).toEqual([1])
  })

  test('a poll around the reader is left alone', () => {
    expect(looksOnce("await expect.poll(() => focusedName(page)).toBe('amount')")).toEqual([])
  })

  test('activeElement is found where it is read, and a comment without one is not', () => {
    expect(
      readsCursor("page.evaluate(() => document.activeElement?.getAttribute('name'))"),
    ).toEqual([1])
    expect(readsCursor('// the cursor lands')).toEqual([])
  })
})
