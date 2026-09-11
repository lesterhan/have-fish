/**
 * Keeps type and spacing on the ladders.
 *
 * This is `no-raw-colour.test.ts` one rung down, and it exists because the same thing
 * happened to size that had happened to colour — with a different cause and a more
 * embarrassing shape.
 *
 * Colour drifted because a scoped `<style>` block cannot share a rule, so the third copy was
 * always the shortest path. Type and space drifted because **the scales started above where
 * the app lives**. `--text-xs` bottomed out at 12px while the app's chrome renders at 9, 10
 * and 11px; `--sp-xs` bottomed out at 8px while the space inside a control is 1 to 6px. 127
 * of the 160 raw font sizes and 313 of the 470 raw spacing values sat *below the smallest
 * available rung*. Nobody was ignoring the scale. There was nothing down there to reach for.
 *
 * The naming was the other half. `--text-xs` carried 157 of 303 token uses, so the app's most
 * common size was called "extra small" and anyone reaching for something genuinely small
 * found the name taken and wrote `10px`. The rungs are named for their job now, and the file
 * that holds them is the only place a size may be declared.
 *
 * So the invariant: in a component's `<style>` block, a size is a token or it is a bug.
 *
 * - **`font-size`, `font-weight`, `letter-spacing`, `line-height`** — always a `var()`. There
 *   is no legitimate raw value for any of them; `inherit` and `normal` pass, because they are
 *   a refusal to set the property rather than a value chosen by hand.
 * - **Raw `px` in `padding`, `margin` or `gap`** — including inside `calc()`, and including
 *   one atom of a four-value shorthand. Every one of the 470 that existed turned out to be
 *   expressible, the six `calc()` expressions included: each was a rung plus a rung, once
 *   rungs existed below 8px.
 *
 * `%`, `em`, `rem`, `ch`, `fr`, `auto` and `0` are untouched. They are relationships to
 * something else on the page rather than a value picked off a ruler, which is the thing this
 * guard is about.
 *
 * `tokens.css` is where sizes are declared and is exempt wholesale. `base.css` is **not** —
 * it is the one place in this app that speaks globally, and until the ladders existed its
 * `.section-bar-title` hard-coded `10px`, `700` and `0.6px`, so the single global class in
 * the design system was the single place it could not cite itself.
 *
 * `EXEMPT` is three declarations and adding a fourth is a design decision, not a way past a
 * failing test. Note what is *not* on it: "this value is too small to matter" is an argument
 * for deleting the declaration, not for keeping it.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { rulesIn, stripNoise, svelteFilesUnder } from '../testing/source-scan'

/** `frontend/src`, from `frontend/src/styles`. */
const SRC = join(import.meta.dir, '..')

/**
 * Raw declarations that are allowed to stand, keyed by the file they live in, with the
 * reason. All three are the same kind of exception: a value that is not text set at a
 * tracking, so no rung on the tracking scale is the right answer.
 */
const EXEMPT: Record<string, { declaration: string; because: string }[]> = {
  'lib/components/spending/SpendingBreakdown.svelte': [
    {
      declaration: 'letter-spacing: -1px',
      because:
        'The bar and the leader are drawn out of repeated glyphs. -1px closes the gaps ' +
        'so the run reads as one continuous rule; it is a drawing, not prose.',
    },
  ],
  'routes/+layout.svelte': [
    {
      declaration: 'letter-spacing: 0.01em',
      because:
        'A hair of tracking on the one serif display face in the case. The label rung ' +
        'at 0.6px is visibly loose on it, and the next rung down is negative.',
    },
  ],
}

/** Properties that must always be a token. `inherit`/`normal` is a refusal, not a value. */
const TOKEN_ONLY = [
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
] as const

/** Properties where a raw `px` anywhere in the value — shorthand or `calc()` — is a bug. */
const NO_RAW_PX =
  /(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?/

const KEYWORD = /^(inherit|initial|unset|normal|revert)$/

function allowed(file: string, declaration: string): boolean {
  return (EXEMPT[file] ?? []).some((e) => declaration.startsWith(e.declaration))
}

/** Every offending declaration in the app's component styles, plus `base.css`. */
function offenders(): string[] {
  const found: string[] = []
  const sources: [string, string][] = svelteFilesUnder(SRC).map((full) => [
    relative(SRC, full),
    readFileSync(full, 'utf8'),
  ])
  sources.push([
    'styles/base.css',
    // `rulesIn` slices past a `<style>` tag, so hand it one.
    `<style>${readFileSync(join(SRC, 'styles/base.css'), 'utf8')}</style>`,
  ])

  for (const [file, source] of sources) {
    for (const rule of rulesIn(stripNoise(source))) {
      for (const raw of rule.body.split(';')) {
        const declaration = raw.trim().replace(/\s+/g, ' ')
        if (!declaration) continue
        const colon = declaration.indexOf(':')
        if (colon === -1) continue
        const property = declaration.slice(0, colon).trim()
        const value = declaration.slice(colon + 1).trim()

        const bad =
          (TOKEN_ONLY.includes(property as (typeof TOKEN_ONLY)[number]) &&
            !value.includes('var(') &&
            !KEYWORD.test(value)) ||
          (NO_RAW_PX.test(property) &&
            NO_RAW_PX.exec(property)![0] === property &&
            /\d+(?:\.\d+)?px/.test(value))

        if (bad && !allowed(file, declaration)) {
          found.push(`${file}  ${rule.selector} { ${declaration} }`)
        }
      }
    }
  }
  return found.sort()
}

describe('type and space stay on the ladder', () => {
  it('no component declares a size of its own', () => {
    const found = offenders()
    expect(
      found,
      found.length
        ? `Use a token, or argue for an EXEMPT entry:\n  ${found.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('scans the app rather than an empty tree', () => {
    // A guard that silently reads nothing passes, which is the worst way for one to fail.
    expect(svelteFilesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('would catch a raw font size', () => {
    const rules = rulesIn('<style>.a { font-size: 13px; }</style>')
    expect(rules[0]?.body).toContain('13px')
  })

  it('every exemption carries a reason', () => {
    for (const entries of Object.values(EXEMPT)) {
      for (const entry of entries) {
        expect(entry.because.length).toBeGreaterThan(40)
      }
    }
  })
})
