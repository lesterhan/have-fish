// What the services share: the accounts the app makes along the way, and a batch's outcome as
// a command returns it.

import { randomUUID } from 'node:crypto'
import type { AccountDoc } from '@have-fish/core/documents'
import type { Failure, Outcome } from '@have-fish/core/outcome'
import type Database from 'better-sqlite3'
import type { BatchOutcome } from '../ledger/apply'
import { liveAccountAt } from '../ledger/store'

/** The id, once the batch is applied; a refusal without its place in the batch. */
export function idOf(applied: BatchOutcome, id: string): Outcome<{ id: string }> {
  if (!applied.ok) {
    const { code, details } = applied.failure
    return { ok: false, failure: { code, details } as Failure }
  }
  return { ok: true, value: { id } }
}

/** The live account at the path, or a new one the app makes, for the same batch. */
export function accountFor(
  db: Database.Database,
  at: Pick<AccountDoc, 'path' | 'kind'>,
  made: { createdAt: number; deviceId: string },
): { id: string; made: AccountDoc[] } {
  const id = liveAccountAt(db, at.path)
  if (id !== undefined) return { id, made: [] }
  const account: AccountDoc = {
    type: 'account',
    id: randomUUID(),
    ...at,
    currency: null,
    deletedAt: null,
    origin: { source: 'system', ...made },
  }
  return { id: account.id, made: [account] }
}
