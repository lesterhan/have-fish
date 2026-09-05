/**
 * One rule the global stylesheet has to keep, pinned because it is easy to reintroduce and
 * impossible to see in CI.
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
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = readFileSync(
  fileURLToPath(new URL('./base.css', import.meta.url)),
  'utf8',
)

describe('the global stylesheet', () => {
  it('does not switch font smoothing off', () => {
    expect(BASE).not.toMatch(/font-smoothing:\s*none/)
  })
})
