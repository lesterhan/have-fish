/**
 * Rules the global stylesheet has to keep, pinned because they are easy to undo and hard to
 * see in a diff.
 *
 * **Font smoothing.**
 *
 * `-webkit-font-smoothing: none` shipped for years with the comment "intentional — keep the
 * crisp pixel rendering". It was an XP-era instinct fighting the app's own reference: Aqua is
 * the era that introduced aggressive font smoothing, so the one line was a large part of why
 * the type read Windows while everything around it read Mac (DESIGN.md §5, §10).
 *
 * It is also invisible from here. The property is implemented in Blink for macOS only, so on
 * Linux — every CI runner and this container — setting it changes nothing at all; two renders
 * of the same text with and without it come back byte-identical. Nobody reviewing a diff or a
 * screenshot on this platform can tell it is back. Hence a test.
 *
 * `antialiased` is the sanctioned fallback if 13px Lucida Grande turns mushy on a real Mac.
 * `none` is not.
 *
 * **The section bar.** Its four-declaration skin lived in twenty-one components, because a
 * scoped `<style>` block cannot share a rule with the file next door and writing it out again
 * is always the shortest path. It had drifted: three panels shouted "PARSERS" in the markup
 * because their local copy of the label rule had lost `text-transform`. The skin is global
 * now, and a component that fills something with `--color-section-bar-bg` is starting the
 * twenty-second copy — so the guard is on that token rather than on the class. The two border
 * tokens stay free: a tab strip drawing its dividers in the bar's edge colour is matching the
 * bar, not rebuilding it.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rulesIn, svelteFilesUnder } from '../testing/source-scan'

const BASE = readFileSync(
  fileURLToPath(new URL('./base.css', import.meta.url)),
  'utf8',
)

/** `frontend/src`, from `frontend/src/styles`. */
const SRC = join(import.meta.dir, '..')

/** The tell. Filling something with the bar's ground is painting a bar. */
const BAR_FILL = '--color-section-bar-bg'

describe('the global stylesheet', () => {
  it('does not switch font smoothing off', () => {
    expect(BASE).not.toMatch(/font-smoothing:\s*none/)
  })

  it('is where the section bar is defined', () => {
    expect(BASE).toContain(BAR_FILL)
  })
})

describe('the section bar is defined once', () => {
  const offenders: string[] = []

  for (const full of svelteFilesUnder(SRC)) {
    for (const rule of rulesIn(readFileSync(full, 'utf8'))) {
      if (rule.body.includes(BAR_FILL)) {
        offenders.push(`${relative(SRC, full)}  ${rule.selector}`)
      }
    }
  }

  it('no component paints its own', () => {
    expect(
      offenders,
      offenders.length
        ? `Add the \`section-bar\` class instead:\n  ${offenders.join('\n  ')}`
        : '',
    ).toEqual([])
  })
})
