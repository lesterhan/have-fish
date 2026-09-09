/**
 * The scanner the guards are built on, checked on its own.
 *
 * Every one of these cases is a bug a guard shipped with. A guard that silently reads
 * nothing passes, which is the worst way for a test to fail, so the scanner is worth its own
 * assertions rather than being trusted because the tests above it are green.
 */

import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import {
  rulesIn,
  sourceFilesUnder,
  stripNoise,
  svelteFilesUnder,
} from './source-scan'

const SRC = join(import.meta.dir, '..')

describe('reading a style block', () => {
  it('does not read a comment as part of the selector under it', () => {
    // The bug this test was written to catch was hidden behind exactly this comment.
    const rules = rulesIn(`<style>
      /* Green here is a status, not a quantity. */
      .progress.complete .fill { color: var(--color-success); }
    </style>`)
    expect(rules).toEqual([
      {
        selector: '.progress.complete .fill',
        body: ' color: var(--color-success); ',
      },
    ])
  })

  it('reads the first rule in the block', () => {
    // Slicing from `<style` rather than past its `>` made the first rule's selector begin
    // with `<`, which the parser skips — so every file's first rule was invisible.
    expect(
      rulesIn('<style>\n  .a { color: red; }\n</style>')[0]?.selector,
    ).toBe('.a')
  })

  it('collapses a wrapped selector onto one line', () => {
    expect(
      rulesIn('<style>\n  .a,\n  .b {\n    color: red;\n  }\n</style>')[0]
        ?.selector,
    ).toBe('.a, .b')
  })

  it('is empty for a file with no style block', () => {
    expect(rulesIn('<script>const a = 1</script>')).toEqual([])
  })
})

describe('stripping noise', () => {
  it('removes block comments, markup comments and line comments', () => {
    expect(stripNoise('/* #fff */ a <!-- #eee --> b\n  // #ddd\n')).not.toMatch(
      /#/,
    )
  })

  it('removes an SVG path, which is coordinates that look like anything', () => {
    expect(stripNoise('<path d="M0 0h8v8" />')).not.toContain('M0')
  })
})

describe('walking the tree', () => {
  it('finds the app rather than an empty directory', () => {
    expect(svelteFilesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('skips build output and dependencies', () => {
    const files = sourceFilesUnder(SRC, ['.ts', '.svelte', '.css'])
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes('.svelte-kit'))).toBe(false)
  })

  it('honours the extension filter', () => {
    expect(
      sourceFilesUnder(SRC, ['.svelte']).every((f) => f.endsWith('.svelte')),
    ).toBe(true)
  })
})
