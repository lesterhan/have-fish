// Signals that the coverage picture has changed and anything showing it should re-fetch.
//
// Fired from inside the API helpers that write coverage rather than from their call sites.
// The status bar is on every screen and the writes are scattered across the import flow, the
// catch-up hub, the reconcile modal and the transaction pages — a convention that depends on
// each of those remembering to invalidate is a convention that will be wrong within a month.
//
// Deliberately rune-free, and therefore not a `.svelte.ts` module: `api.ts` imports it, and
// `api.ts` is imported by plain unit tests that bun runs without the Svelte compiler. A
// `$state` here would take every one of those down. Subscribers own their own reactivity.

type Listener = () => void

const listeners = new Set<Listener>()

export function bumpCoverage(): void {
  // Copied before iterating so a listener unsubscribing in response cannot skip its neighbour.
  for (const listener of [...listeners]) listener()
}

/** Subscribes to coverage writes. Returns the unsubscribe. */
export function onCoverageChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
