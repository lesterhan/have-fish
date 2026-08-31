/**
 * The save lifecycle behind a settings control that commits on its own.
 *
 * The account settings modal has no Save button and no Cancel: every control writes as
 * soon as you touch it. That trade buys away a three-endpoint transaction, and the price
 * is that each row has to say what happened to it — an immediate save with no
 * acknowledgement is indistinguishable from a dead control.
 *
 * The timing and the wording live here rather than in the component so both are testable
 * without a DOM, and so every row tells the same story at the same pace.
 */

/** How long a "Saved" acknowledgement stays up before fading back to idle. */
export const SAVED_LINGER_MS = 1500

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'error'; message: string }

/**
 * What a single `run()` did.
 *
 * `superseded` means a later save started before this one settled, so its result — success
 * or failure — was discarded. Callers use it to decide whether to apply the response: a
 * stale response is not the server's current truth and must not be written back into the
 * UI.
 */
export type SaveOutcome<T> =
  | { status: 'saved'; value: T }
  | { status: 'error'; message: string }
  | { status: 'superseded' }

/**
 * Opaque timer handle: `number` in the browser, `Timeout` under Node/Bun. The tracker only
 * ever hands one back to the `clearTimer` it was given, so it does not need to know which.
 */
export type TimerHandle = unknown

export interface SaveTrackerOptions {
  /** Shown when the failure carries no usable message of its own. */
  fallbackMessage: string
  /** Called on every state change. The component assigns it into a `$state` rune. */
  onchange: (state: SaveState) => void
  /** Injectable for tests; defaults to the real timer. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  /** Injectable for tests; defaults to {@link SAVED_LINGER_MS}. */
  lingerMs?: number
}

/** Pull a human-readable message off whatever was thrown, or fall back. */
export function saveErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : ''
  return message || fallback
}

export class SaveTracker {
  #state: SaveState = { status: 'idle' }
  #timer: TimerHandle = null
  /**
   * Bumped on every `run()` and on `cancel()`. An attempt may only report if it is still
   * the newest one, which is what makes an out-of-order response harmless.
   */
  #attempt = 0

  readonly #fallback: string
  readonly #emit: (state: SaveState) => void
  readonly #setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly #clearTimer: (handle: TimerHandle) => void
  readonly #lingerMs: number

  constructor(options: SaveTrackerOptions) {
    this.#fallback = options.fallbackMessage
    this.#emit = options.onchange
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.#clearTimer =
      options.clearTimer ??
      ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.#lingerMs = options.lingerMs ?? SAVED_LINGER_MS
  }

  get state(): SaveState {
    return this.#state
  }

  /**
   * Run one save. The row goes to `saving` immediately — which also clears any standing
   * error — and settles on `saved` or `error` when the request lands.
   *
   * If a second `run()` starts first, this one resolves `superseded` and reports nothing:
   * last write wins, because the newest request is the one whose response describes the
   * state the server was left in.
   */
  async run<T>(operation: () => Promise<T>): Promise<SaveOutcome<T>> {
    const attempt = ++this.#attempt
    this.#clearPendingLinger()
    this.#set({ status: 'saving' })

    try {
      const value = await operation()
      if (attempt !== this.#attempt) return { status: 'superseded' }
      this.#set({ status: 'saved' })
      this.#timer = this.#setTimer(() => {
        this.#timer = null
        this.#set({ status: 'idle' })
      }, this.#lingerMs)
      return { status: 'saved', value }
    } catch (error) {
      if (attempt !== this.#attempt) return { status: 'superseded' }
      const message = saveErrorMessage(error, this.#fallback)
      // Deliberately no timer: an error stays up until the next attempt replaces it.
      this.#set({ status: 'error', message })
      return { status: 'error', message }
    }
  }

  /**
   * Detach the tracker: drop the pending linger and make any in-flight save resolve
   * `superseded` rather than emitting into a component that has gone away. For unmount —
   * it does not reset the visible state, because nothing is left to see it.
   */
  cancel(): void {
    this.#attempt++
    this.#clearPendingLinger()
  }

  /**
   * Cancel, and go back to idle.
   *
   * For a surface that is dismissed and reopened rather than unmounted: a settings modal
   * reopened later resyncs its controls from the server, so a standing error from the last
   * visit would sit beside a value that is now correct — which is a lie, not history.
   */
  reset(): void {
    this.cancel()
    if (this.#state.status !== 'idle') this.#set({ status: 'idle' })
  }

  #clearPendingLinger(): void {
    if (this.#timer === null) return
    this.#clearTimer(this.#timer)
    this.#timer = null
  }

  #set(state: SaveState): void {
    this.#state = state
    this.#emit(state)
  }
}
