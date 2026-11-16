// The bench's pick: which part drew an element, the tokens its part's rules name, and the lines
// the bench says of it. No DOM; `bench.ts` reads the frame and draws.

import { deriveTokens } from '../shared/theme/derive'
import { BUILT_IN_LAB } from './lab'
import { tokensIn } from './tokens'

/** The property Svelte marks each element a part draws with, in dev only. */
export const SVELTE_META = '__svelte_meta'

/** Where a part drew an element: its file from desktop/, and the line in it. */
export type Part = { file: string; line: number }

/** The part Svelte's dev mark names: null with no mark, or one it can't read. */
export function partOf(meta: unknown): Part | null {
  if (typeof meta !== 'object' || meta === null || !('loc' in meta)) return null
  const { loc } = meta
  if (typeof loc !== 'object' || loc === null || !('file' in loc) || !('line' in loc)) return null
  const { file, line } = loc
  return typeof file === 'string' && typeof line === 'number' ? { file, line } : null
}

/** How many of an element's marks, from its own up, name its part's file: 1 with no mark. */
export function partRun(metas: readonly unknown[]): number {
  const file = partOf(metas[0])?.file
  if (file === undefined) return 1
  const differs = metas.findIndex((meta) => partOf(meta)?.file !== file)
  return differs === -1 ? metas.length : differs
}

/** A CSS rule, as far as the pick reads one. Its cssText, never read, makes a CSSRule one. */
export type Rule = {
  readonly cssText: string
  readonly selectorText?: string
  readonly style?: { readonly cssText: string }
  readonly conditionText?: string
  readonly cssRules?: Iterable<Rule>
}

/** Each matching style rule's declarations, in order, read through a grouping rule that holds. */
export function matchedOf(
  rules: Iterable<Rule>,
  matches: (selector: string) => boolean,
  holds: (condition: string) => boolean,
): string[] {
  return [...rules].flatMap((rule) => {
    if (rule.selectorText !== undefined) {
      try {
        return matches(rule.selectorText) ? [rule.style?.cssText ?? ''] : []
      } catch {
        // A selector `matches` refuses, as `@page`'s empty one, matches nothing.
        return []
      }
    }
    if (rule.cssRules === undefined) return []
    if (rule.conditionText !== undefined && !holds(rule.conditionText)) return []
    return matchedOf(rule.cssRules, matches, holds)
  })
}

/** Every token tokens.css declares, the colours' last: the names a part's rules can read. */
export function tokenNamesOf(css: string): string[] {
  return [
    ...tokensIn(css).map((token) => token.name),
    ...Object.keys(deriveTokens(BUILT_IN_LAB.light)),
  ]
}

/** Each of `names` the blocks read through var(), once, in the order they first read it. */
export function namesRead(blocks: readonly string[], names: readonly string[]): string[] {
  const read = blocks.flatMap((block) =>
    [...block.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? ''),
  )
  return [...new Set(read)].filter((name) => names.includes(name))
}
