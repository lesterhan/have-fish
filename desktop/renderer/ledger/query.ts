// What a place reads of main beside the ledger's lists: one load over the commands it names, asked
// again after a change of a kind they read. The latest load wins, and a hidden place waits.

import type { Bridge, CommandName, InputOf, Values, Wire, WireFailure } from '../../shared/commands'
import { traits } from '../../shared/traits'

/** The bridge's invoke, narrowed to the commands a query was given. */
export type Ask<N extends CommandName> = <M extends N>(
  name: M,
  input: InputOf<M>,
) => Promise<Wire<Values[M]>>

export type QueryState<V> = {
  /** The last good answer; null until one comes. */
  value: V | null
  /** Why the last load failed; null once one succeeds. */
  failure: WireFailure | null
}

export type Query<I, V> = {
  /** Listens for main's changes. Returns the stop. */
  start(): () => void
  /** The input from now on; shown, it loads at once. */
  set(input: I): void
  /** Shown and stale, it loads; hidden, it asks nothing. */
  show(shown: boolean): void
  /** Resolves once no load is on its way or queued. */
  caughtUp(): Promise<void>
  /** Svelte's store contract: `$query` in a component. */
  subscribe(listener: (state: QueryState<V>) => void): () => void
}

/** A query over `bridge`, loading with `load`. Nothing is asked until it is set and shown. */
export function query<N extends CommandName, I, V>(
  bridge: Pick<Bridge, 'invoke' | 'onChanged'>,
  names: readonly N[],
  load: (ask: Ask<N>, input: I) => Promise<Wire<V>>,
): Query<I, V> {
  const reads = new Set(names.flatMap((name) => traits[name].reads))
  const ask: Ask<N> = (name, input) => bridge.invoke(name, input)
  let state: QueryState<V> = { value: null, failure: null }
  const listeners = new Set<(state: QueryState<V>) => void>()
  let input: { of: I } | null = null
  let shown = false
  let stale = true
  /** Counts loads started: an answer older than the latest is dropped. */
  let epoch = 0
  /** The load on its way, and the one queued behind it. */
  let running: Promise<void> | null = null
  let queued: Promise<void> | null = null

  /** The input to load for: set, shown and stale; else null. */
  const due = (): { of: I } | null => (stale && shown ? input : null)

  function emit(next: QueryState<V>) {
    state = next
    for (const listener of listeners) listener(state)
  }

  /** A numbered load: its answer is kept only while no later load has started. */
  async function loadAndKeep(asked: I): Promise<void> {
    const mine = ++epoch
    stale = false
    const answer = await load(ask, asked)
    if (mine !== epoch) return
    emit(
      answer.ok ? { value: answer.value, failure: null } : { value: state.value, failure: answer },
    )
  }

  /** Starts a load now, whatever is on its way: the one before it loses. */
  function loadNow(asked: I): Promise<void> {
    const loading: Promise<void> = loadAndKeep(asked).finally(() => {
      if (running === loading) running = null
    })
    running = loading
    return loading
  }

  /** A load for what is due, after the one on its way if any; changes meanwhile share it. */
  function refresh(): Promise<void> {
    const next = due()
    if (next === null) return Promise.resolve()
    if (running === null) return loadNow(next.of)
    queued ??= running.then(() => {
      queued = null
      return refresh()
    })
    return queued
  }

  return {
    start(): () => void {
      return bridge.onChanged((changed) => {
        if (!changed.some((c) => reads.has(c.type))) return
        stale = true
        void refresh()
      })
    },
    set(next: I): void {
      input = { of: next }
      stale = true
      if (shown) void loadNow(next)
    },
    show(next: boolean): void {
      shown = next
      void refresh()
    },
    // A `set` can replace the load on its way while one is queued, so wait until both are done.
    async caughtUp(): Promise<void> {
      for (let next = queued ?? running; next !== null; next = queued ?? running) await next
    },
    subscribe(listener: (state: QueryState<V>) => void): () => void {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
  }
}
