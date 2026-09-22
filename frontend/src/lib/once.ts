/**
 * Wraps an async function so it runs at most once, and hands every later caller the same
 * promise — until it is forgotten, or it fails.
 *
 * A rejection is deliberately not kept. Caching one would mean a single blip while the
 * backend restarts is replayed to every subsequent caller for the life of the page,
 * turning a momentary failure into a permanent one.
 */
export type Once<T> = {
  (): Promise<T>
  /** Discard the cached result, so the next call runs the function again. */
  forget(): void
}

export function once<T>(fn: () => Promise<T>): Once<T> {
  let inFlight: Promise<T> | null = null

  const run = (() => {
    if (!inFlight) {
      inFlight = fn().catch((err) => {
        inFlight = null
        throw err
      })
    }
    return inFlight
  }) as Once<T>

  run.forget = () => {
    inFlight = null
  }

  return run
}
