// The density the window is set in: `data-density` on the page, which `tokens.css` reads, and
// every list told to measure its rows again.

import type { Density } from '../shared/density'

const listeners = new Set<() => void>()

/** Sets the page's density, then lets each list read the new row and band heights. */
export function showDensity(density: Density): void {
  document.documentElement.dataset.density = density
  for (const then of listeners) then()
}

/** Calls `then` after each change to the density. Returns the unsubscribe. */
export function onDensity(then: () => void): () => void {
  listeners.add(then)
  return () => {
    listeners.delete(then)
  }
}
