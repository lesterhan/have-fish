// What this device has written that sync hasn't sent. Apply writes it, inside the transaction
// that writes the document, so the two never disagree; sync reads it and clears it.

import { randomUUID } from 'node:crypto'
import type { LedgerDocument } from '@have-fish/core/documents'
import { formatVersion } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { outbox } from '../db/schema'

/** Queues a local write: replaces the document's row, under a new `rowId`. */
export function enqueue(db: Database.Database, v: Versioned<LedgerDocument>): void {
  const row = {
    rowId: randomUUID(),
    docType: v.doc.type,
    docId: v.doc.id,
    version: formatVersion(v.version),
    body: JSON.stringify({ doc: v.doc, version: v.version }),
  }
  drizzle(db)
    .insert(outbox)
    .values(row)
    .onConflictDoUpdate({ target: [outbox.docType, outbox.docId], set: row })
    .run()
}
