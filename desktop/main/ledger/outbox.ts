// What this device has written that sync hasn't sent. Apply writes it, inside the transaction
// that writes the document, so the two never disagree; sync reads it and clears it.

import { randomUUID } from 'node:crypto'
import {
  DOCUMENT_TYPES,
  type DocumentTypeName,
  type LedgerDocument,
} from '@have-fish/core/documents'
import { formatVersion } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { and, eq, sql } from 'drizzle-orm'
import { excludedRow, perConnection, placeholderRow } from '../db/prepared'
import { outbox } from '../db/schema'

/** Each type's rank from the table, so the outbox sends in the order a batch applies in. */
const rankOf = sql.join(
  [
    sql`CASE ${outbox.docType}`,
    ...Object.entries(DOCUMENT_TYPES).map(([type, { rank }]) => sql`WHEN ${type} THEN ${rank}`),
    sql`END`,
  ],
  sql` `,
)

const statements = perConnection((orm) => ({
  enqueue: orm
    .insert(outbox)
    .values(placeholderRow(outbox))
    .onConflictDoUpdate({ target: [outbox.docType, outbox.docId], set: excludedRow(outbox) })
    .prepare(),
  supersede: orm
    .delete(outbox)
    .where(
      and(
        eq(outbox.docType, sql.placeholder('docType')),
        eq(outbox.docId, sql.placeholder('docId')),
      ),
    )
    .prepare(),
  queued: orm
    .select()
    .from(outbox)
    .orderBy(rankOf, outbox.version)
    .limit(sql.placeholder('limit'))
    .prepare(),
  acknowledge: orm
    .delete(outbox)
    .where(eq(outbox.rowId, sql.placeholder('rowId')))
    .prepare(),
}))

/** Queues a local write: replaces the document's row, under a new `rowId`. */
export function enqueue(db: Database.Database, v: Versioned<LedgerDocument>): void {
  statements(db).enqueue.run({
    rowId: randomUUID(),
    docType: v.doc.type,
    docId: v.doc.id,
    version: formatVersion(v.version),
    body: JSON.stringify({ doc: v.doc, version: v.version }),
  })
}

/** A version from elsewhere won, so what was queued here for the document is already beaten. */
export function supersede(db: Database.Database, type: DocumentTypeName, id: string): void {
  statements(db).supersede.run({ docType: type, docId: id })
}

export type OutboxRow = typeof outbox.$inferSelect

/** What waits to be sent, by rank: a posting rarely arrives before its account. */
export function queued(db: Database.Database, limit: number): OutboxRow[] {
  return statements(db).queued.all({ limit })
}

/** Sent and stored by the relay. By `rowId` only: an edit made since has a new one, and stays. */
export function acknowledge(db: Database.Database, rowIds: string[]): void {
  const { acknowledge } = statements(db)
  // One row at a time, so one statement serves a list of any length.
  db.transaction(() => {
    for (const rowId of rowIds) acknowledge.run({ rowId })
  })()
}
