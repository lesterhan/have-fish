/**
 * Picks between the two readings of a count sentence.
 *
 * This exists to make one thing impossible: the mid-sentence splice.
 *
 * ```ts
 * // no — this is not a message, it is two fragments and a ternary
 * `${n} transaction${n === 1 ? '' : 's'} imported`
 *
 * // yes — both readings are prose, both live in the copy file
 * plural(n, `${n} transaction imported`, `${n} transactions imported`)
 * ```
 *
 * The second form is longer and that is the point. A copy edit to the singular is a copy
 * edit to a sentence someone can read, not to a fragment either side of a conditional.
 * It is also the only form that survives contact with a second language: Polish needs
 * three forms, Chinese needs none, and no message format can express "append an s to the
 * middle of my sentence." Whole sentences can be swapped; spliced ones cannot.
 *
 * English's rule is `n === 1` exactly — CLDR's `one` category is "integer 1 and no
 * fractional digits", so 0, 1.0 and 21 all take the plural. Nothing here needs to be
 * cleverer than that until a second locale arrives, at which point this function is the
 * one place that changes.
 */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other
}
