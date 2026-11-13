// What one opening of the line wrote: the lines it wrote, newest first, and the ones an undo took
// back out of it, so a redo can put them back. `Batch.svelte` draws it; `Spends.svelte` holds it.

import type { ListedTransaction } from '../../shared/commands'

export type Batch = {
  /** The lines this opening wrote, newest first. */
  lines: readonly ListedTransaction[]
  /** The newest lines an undo took out, the most recent first. */
  takenBack: readonly ListedTransaction[]
}

/** The batch with no lines and nothing taken back: the line opens on it. */
export const EMPTY: Batch = { lines: [], takenBack: [] }

/** A line written: it goes on top, and a new step drops redo, so nothing is taken back. */
export function added(batch: Batch, line: ListedTransaction): Batch {
  return { lines: [line, ...batch.lines], takenBack: [] }
}

/** After an undo or redo: the newest line out, or the newest taken back in; else the batch. */
export function movedBy(batch: Batch, id: string): Batch {
  const newest = batch.lines[0]
  if (newest?.id === id) {
    return { lines: batch.lines.slice(1), takenBack: [newest, ...batch.takenBack] }
  }
  const back = batch.takenBack[0]
  if (back?.id === id) {
    return { lines: [back, ...batch.lines], takenBack: batch.takenBack.slice(1) }
  }
  return batch
}

/** What lights where it lands, and what is selected: every line of the batch, the newest. */
export function landing(batch: Batch): { ids: ReadonlySet<string>; newest: string | null } {
  return { ids: new Set(batch.lines.map((line) => line.id)), newest: batch.lines[0]?.id ?? null }
}
