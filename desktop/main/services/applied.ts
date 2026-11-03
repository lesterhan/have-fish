// A batch's outcome as a command returns it.

import type { Failure, Outcome } from '@have-fish/core/outcome'
import type { BatchOutcome } from '../ledger/apply'

/** The id, once the batch is applied; a refusal without its place in the batch. */
export function idOf(applied: BatchOutcome, id: string): Outcome<{ id: string }> {
  if (!applied.ok) {
    const { code, details } = applied.failure
    return { ok: false, failure: { code, details } as Failure }
  }
  return { ok: true, value: { id } }
}
