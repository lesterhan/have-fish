// The `preferences` blob on a user's settings row: free-form display preferences, one key per
// feature (`hiddenAccountIds`, `illiquidAccountIds`, `catchUp`, …). Every change to it is
// worked out here, in plain objects, and written back whole by `settings-service.ts` (#278).
// Postgres used to do the merging with its own operators, which no other database has.

export type Preferences = Record<string, unknown>

/** A stored blob as an object: anything that isn't one (a scalar, an array) reads as empty. */
export function asPreferences(value: unknown): Preferences {
  return isObject(value) ? value : {}
}

/**
 * `patch` laid over `current`, one level deep: each key in the patch replaces that key
 * whole, and every key it doesn't name is kept. A key set to null is stored as null, not
 * removed.
 */
export function mergePreferences(current: Preferences, patch: Preferences): Preferences {
  return { ...current, ...patch }
}

/**
 * `current` with one account's catch-up overrides replaced, and every other account's and
 * every other key left alone. An empty override removes the account's entry, so the blob
 * doesn't keep an empty object for every account the user ever touched.
 */
export function withCatchUpOverride(
  current: Preferences,
  accountId: string,
  override: Record<string, unknown>,
): Preferences {
  const catchUp = isObject(current.catchUp) ? { ...current.catchUp } : undefined
  if (Object.keys(override).length === 0) {
    if (!catchUp) return current
    delete catchUp[accountId]
    return { ...current, catchUp }
  }
  return { ...current, catchUp: { ...catchUp, [accountId]: override } }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
