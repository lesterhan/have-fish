import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { type DbTransaction, db } from '../db'
import { importSessions } from '../db/schema'

// The import page's sessions (#535): one in-progress import per user per file, kept until
// its commit lands or the user discards it. The payload is the page's own state and nothing
// here reads it.

/** A session untouched this long is dropped the next time the list is read. */
export const MAX_AGE_DAYS = 30

/** Saving one more evicts the least recently saved past this many. */
export const MAX_SESSIONS = 20

const DAY_MS = 24 * 60 * 60 * 1000

/** What the list shows of a session: everything but the payload, which is the heavy part. */
export type SessionSummary = {
  fileHash: string
  fileName: string
  version: number
  rowCount: number
  lastError: unknown
  savedAt: string
}

export type StoredSession = SessionSummary & { payload: unknown }

export type SessionInput = {
  fileName: string
  version: number
  rowCount: number
  payload: unknown
  lastError: unknown
}

const summaryColumns = {
  fileHash: importSessions.fileHash,
  fileName: importSessions.fileName,
  version: importSessions.version,
  rowCount: importSessions.rowCount,
  lastError: importSessions.lastError,
  updatedAt: importSessions.updatedAt,
}

/** The caller's sessions, most recently saved first, after dropping the expired ones. */
export async function listSessions(userId: string, now = new Date()): Promise<SessionSummary[]> {
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS)
  await db
    .delete(importSessions)
    .where(and(eq(importSessions.userId, userId), lt(importSessions.updatedAt, cutoff)))
  const rows = await db
    .select(summaryColumns)
    .from(importSessions)
    .where(eq(importSessions.userId, userId))
    .orderBy(desc(importSessions.updatedAt))
  return rows.map(summaryOf)
}

/** One of the caller's sessions with its payload, or null when there is none for that file. */
export async function readSession(userId: string, fileHash: string): Promise<StoredSession | null> {
  const [row] = await db
    .select({ ...summaryColumns, payload: importSessions.payload })
    .from(importSessions)
    .where(and(eq(importSessions.userId, userId), eq(importSessions.fileHash, fileHash)))
  if (!row) return null
  return { ...summaryOf(row), payload: row.payload }
}

/**
 * Create or replace the caller's session for this file, then evict past `MAX_SESSIONS`.
 * Last write wins: two tabs on the same file overwrite each other, as they did in one
 * browser's storage.
 */
export async function saveSession(
  userId: string,
  fileHash: string,
  input: SessionInput,
): Promise<{ savedAt: string }> {
  const updatedAt = new Date()
  const values = { ...input, lastError: input.lastError ?? null }
  await db
    .insert(importSessions)
    .values({ userId, fileHash, ...values, updatedAt })
    .onConflictDoUpdate({
      target: [importSessions.userId, importSessions.fileHash],
      // Set by hand: `$onUpdate` fires on an update statement, not on an upsert's update.
      set: { ...values, updatedAt },
    })

  // Trimmed here rather than with OFFSET, which SQLite refuses without a LIMIT; the list is
  // never more than one past the cap.
  const surplus = (
    await db
      .select({ id: importSessions.id })
      .from(importSessions)
      .where(eq(importSessions.userId, userId))
      .orderBy(desc(importSessions.updatedAt))
  ).slice(MAX_SESSIONS)
  if (surplus.length > 0) {
    await db.delete(importSessions).where(
      inArray(
        importSessions.id,
        surplus.map((r) => r.id),
      ),
    )
  }
  return { savedAt: updatedAt.toISOString() }
}

/** Remove the caller's session for this file, if there is one. */
export async function deleteSession(userId: string, fileHash: string): Promise<void> {
  await deleteSessionIn(db, userId, fileHash)
}

/**
 * The same, inside a unit of work: the commit calls it in the transaction that writes the
 * rows, so the session goes exactly when they land and stays when anything is refused.
 */
export async function deleteSessionIn(
  exec: DbTransaction | typeof db,
  userId: string,
  fileHash: string,
): Promise<void> {
  await exec
    .delete(importSessions)
    .where(and(eq(importSessions.userId, userId), eq(importSessions.fileHash, fileHash)))
}

function summaryOf(row: {
  fileHash: string
  fileName: string
  version: number
  rowCount: number
  lastError: unknown
  updatedAt: Date
}): SessionSummary {
  const { updatedAt, ...rest } = row
  return { ...rest, savedAt: updatedAt.toISOString() }
}
