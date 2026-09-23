/**
 * The entry a caller is asserting is there.
 *
 * `rows[0].amount` and `byId[walletId].balance` both assert something silently: that the
 * list came back non-empty, that the id is one this map holds. `noUncheckedIndexedAccess`
 * makes those assertions something the code has to write down, and writing them here
 * rather than as `!` at each site means a short list fails with a sentence naming what was
 * missing instead of `Cannot read properties of undefined` further along.
 *
 * Mostly used by tests, which is where the assumption is usually safe and always
 * undeclared. A screen that indexes a list the user can empty wants a real check, not this.
 */
export function at<T>(
  from: readonly T[] | Readonly<Record<string, T>>,
  key: string | number = 0,
): T {
  const entry = (from as Readonly<Record<string | number, T | undefined>>)[key]
  if (entry === undefined) {
    const had = Array.isArray(from)
      ? `length ${from.length}`
      : `keys ${Object.keys(from).join(', ') || '(none)'}`
    throw new Error(`nothing at [${String(key)}] — ${had}`)
  }
  return entry
}
