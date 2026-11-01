// What this device has written that sync hasn't sent. Apply writes it, inside the transaction
// that writes the document, so the two never disagree; sync reads it and clears it.

import { randomUUID } from 'node:crypto'
import type { LedgerDocument } from '@have-fish/core/documents'
import { formatVersion } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { and, eq, inArray, sql } from 'drizzle-orm'
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

/** A version from elsewhere won, so what was queued here for the document is already beaten. */
export function supersede(db: Database.Database, type: LedgerDocument['type'], id: string): void {
  drizzle(db)
    .delete(outbox)
    .where(and(eq(outbox.docType, type), eq(outbox.docId, id)))
    .run()
}

export type OutboxRow = typeof outbox.$inferSelect

/** What waits to be sent: accounts first, so a posting rarely arrives before its account. */
export function queued(db: Database.Database, limit: number): OutboxRow[] {
  return drizzle(db)
    .select()
    .from(outbox)
    .orderBy(sql`${outbox.docType} = 'account' DESC`, outbox.version)
    .limit(limit)
    .all()
}

/** Sent and stored by the relay. By `rowId` only: an edit made since has a new one, and stays. */
export function acknowledge(db: Database.Database, rowIds: string[]): void {
  if (rowIds.length === 0) return
  drizzle(db).delete(outbox).where(inArray(outbox.rowId, rowIds)).run()
}
