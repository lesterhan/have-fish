// What this session can undo and redo, newest last. Pure: it holds steps and knows their order,
// and the ledger side (`steps.ts`) decides what a step is and writes it back.

export class History<S> {
  #done: S[] = []
  #undone: S[] = []

  /** A new change: it can be undone, and nothing undone before it can be redone any more. */
  record(step: S): void {
    this.#done.push(step)
    this.#undone = []
  }

  /** The step Undo would take back, if any. */
  nextUndo(): S | undefined {
    return this.#done.at(-1)
  }

  /** The step Redo would put back, if any. */
  nextRedo(): S | undefined {
    return this.#undone.at(-1)
  }

  /** `nextUndo()` was taken back, so it is next to redo. */
  undid(): void {
    const step = this.#done.pop()
    if (step !== undefined) this.#undone.push(step)
  }

  /** `nextRedo()` was put back, so it is next to undo. */
  redid(): void {
    const step = this.#undone.pop()
    if (step !== undefined) this.#done.push(step)
  }

  /** `nextUndo()` can never be taken back, so it leaves the history. */
  dropUndo(): void {
    this.#done.pop()
  }

  /** `nextRedo()` can never be put back, so it leaves the history. */
  dropRedo(): void {
    this.#undone.pop()
  }

  /** Every step, done and undone, through `f`, in place. */
  map(f: (step: S) => S): void {
    this.#done = this.#done.map(f)
    this.#undone = this.#undone.map(f)
  }
}
