/**
 * Reading this codebase's own source, for the guards that check it.
 *
 * Five tests scan the tree — the raw-colour guard, the status-vs-money guard, the chrome
 * button census, the copy-extraction check and the `$lib` import rule — and each had written
 * its own directory walker. Five copies is bad enough; they had also diverged, which is
 * worse. Two skipped `node_modules` and `.svelte-kit` and three did not, so three of them
 * were one moved build directory away from linting their own dependencies. Nobody would have
 * noticed until a guard took four minutes and failed inside a package it does not own.
 *
 * These guards exist because a rule that only lives in prose drifts. The same is true of the
 * code that enforces them.
 *
 * Nothing here imports through `$lib` — see `lib-imports.test.ts` for why a value import
 * through the alias resolves locally and fails on CI.
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Build output and dependencies. Never source, always large. */
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit'])

/**
 * Every file under `dir` whose name ends in one of `extensions`, recursively, in the order
 * the filesystem gives them. Callers that report offenders should sort; callers that only
 * count need not.
 */
export function sourceFilesUnder(
  dir: string,
  extensions: readonly string[],
): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFilesUnder(full, extensions))
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

/** The common case. */
export function svelteFilesUnder(dir: string): string[] {
  return sourceFilesUnder(dir, ['.svelte'])
}

/**
 * Comments, and the `<path d="…">` guts of inline SVG.
 *
 * Both are noise to every guard here and actively misleading to some: the comments in this
 * codebase quote the exact hex values of the bugs they document, and an SVG path is a string
 * of coordinates that will eventually spell something a regex cares about.
 */
export function stripNoise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\n)\s*(\/\/|\s\*)[^\n]*/g, '$1')
    .replace(/\sd="[^"]*"/g, '')
}

export interface Rule {
  /** Whitespace collapsed to single spaces, so a wrapped selector reads as one line. */
  selector: string
  body: string
}

/**
 * The rules in a component's `<style>` block.
 *
 * Comments go first — one of them explains the status-versus-money distinction, and reading
 * it as part of the selector beneath it is how the first draft of that guard managed to miss
 * the rule it was written for. Nested at-rules leave their prelude behind as a rule with no
 * declarations, which is harmless.
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
