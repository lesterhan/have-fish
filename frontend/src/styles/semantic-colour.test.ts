/**
 * Keeps the two colour vocabularies apart.
 *
 * The app names its colours twice. `--color-success` / `--color-warning` / `--color-danger`
 * say how something *went*; `--color-amount-positive` / `--color-amount-negative` say which
 * way *money* moved. In both themes each status token and its money twin hold the same value,
 * because the app does mean the same thing by green and by red — and that is exactly what
 * made the two sets interchangeable at the call site and let nineteen rules pick the wrong
 * one. `.form-error` was painted in money-out red in five places. `CatchUpProgress` carried
 * the comment "green here is a status, not a quantity" directly above a rule reaching for
 * `--color-amount-positive`.
 *
 * Nothing looked wrong, which is the problem: the mistake is invisible until someone changes
 * one of the two values, at which point a form error follows the expense colour somewhere new
 * and nobody knows why. The name is the only thing carrying the distinction, so a test has to
 * defend it.
 *
 * **The rule is one-way.** A selector that names a *status* may not reach for a money token —
 * an invalid field is not an expense. The reverse is legitimate and stays legal: a money
 * amount can be flagged for attention, which is what `TransactionDetail`'s amber FX-fee
 * amount is, and `.balance-bad` is a status about a balance rather than a balance.
 *
 * It is a floor, not a ceiling. It reads intent from selector names, so it catches the rules
 * whose names say what they are (`.form-error`, `.summary-warn`, `.stale`, `.ledger-foot.ok`)
 * and misses the ones named for their shape (`.check`, `.remove-btn:hover`). Those are still
 * wrong when they are wrong; they just need a reader rather than a regex.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** `frontend/src`, from `frontend/src/styles`. */
const SRC = join(import.meta.dir, '..')

/** Words in a selector that say the rule is about how something went, not about money. */
const STATUS_WORDS = [
  'ok',
  'bad',
  'error',
  'warn',
  'danger',
  'invalid',
  'required',
  'stale',
  'success',
  'failed',
  'balanced',
  'complete',
  'incomplete',
  'conflict',
  'missing',
]

/** The tokens that measure money. A status rule may not use one. */
const MONEY_TOKENS = ['--color-amount-positive', '--color-amount-negative']

const SKIP_DIRS = new Set(['node_modules', '.svelte-kit'])

function svelteFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...svelteFilesUnder(full))
    else if (entry.endsWith('.svelte')) out.push(full)
  }
  return out
}

export interface Rule {
  selector: string
  body: string
}

/**
 * The rules in a component's `<style>` block. Comments go first — one of them explains this
 * very distinction, and reading it as part of the selector beneath it is how the prototype of
 * this test managed to miss the rule it was written for. Nested at-rules leave their prelude
 * behind as a rule with no declarations, which is harmless.
 */
export function rulesIn(source: string): Rule[] {
  const open = source.indexOf('<style')
  if (open === -1) return []
  // Past the `>` of the opening tag: leaving it in makes the block's first rule read as a
  // selector starting with `<`, which the loop below then skips. Every file's first rule.
  const start = source.indexOf('>', open) + 1
  const style = source.slice(start).replace(/\/\*[\s\S]*?\*\//g, '')

  const rules: Rule[] = []
  for (const [, selector, body] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const cleaned = selector!.trim().replace(/\s+/g, ' ')
    if (cleaned.startsWith('@') || cleaned.startsWith('<')) continue
    rules.push({ selector: cleaned, body: body! })
  }
  return rules
}

/** Whole-word, so `.checkbox` is not `ok` and `.warning-free` is still `warn`-ish. */
export function statusWordsIn(selector: string): string[] {
  const lower = selector.toLowerCase()
  return STATUS_WORDS.filter((word) =>
    new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(lower),
  )
}

export function moneyTokensIn(body: string): string[] {
  return MONEY_TOKENS.filter((token) =>
    new RegExp(`${token}\\b`).test(body),
  ).sort()
}

// --- the detectors themselves -------------------------------------------------------------

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

  it('matches a status word only as a whole word', () => {
    expect(statusWordsIn('.checkbox')).toEqual([])
    expect(statusWordsIn('.ledger-foot.ok')).toEqual(['ok'])
    expect(statusWordsIn('.form-error')).toEqual(['error'])
  })

  it('finds a money token wherever it sits in a declaration', () => {
    expect(
      moneyTokensIn(
        'background: color-mix(in srgb, var(--color-amount-positive) 55%, white);',
      ),
    ).toEqual(['--color-amount-positive'])
  })
})

// --- the contract -------------------------------------------------------------------------

describe('a status is not an amount', () => {
  const offenders: string[] = []

  for (const full of svelteFilesUnder(SRC)) {
    const file = relative(SRC, full)
    for (const rule of rulesIn(readFileSync(full, 'utf8'))) {
      const words = statusWordsIn(rule.selector)
      if (words.length === 0) continue
      for (const token of moneyTokensIn(rule.body)) {
        offenders.push(`${file}  ${rule.selector}  uses ${token}`)
      }
    }
  }

  it('no rule named for a status paints itself with a money token', () => {
    expect(offenders).toEqual([])
  })

  it('scanned the app rather than an empty directory', () => {
    expect(svelteFilesUnder(SRC).length).toBeGreaterThan(50)
  })
})
