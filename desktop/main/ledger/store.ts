// Writes a document as rows and reads it back. It stores what it is given: choosing which
// version wins, and checking accounts, happen before this is called.

import type { DocumentOf, DocumentTypeName, LedgerDocument } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { and, countDistinct, eq, isNull, sql } from 'drizzle-orm'
import { perConnection } from '../db/prepared'
import { accounts, postings } from '../db/schema'
import { STORED_TYPES } from './document-types'

const statements = perConnection((orm) => ({
  transactionsUsing: orm
    .select({ n: countDistinct(postings.transactionId) })
    .from(postings)
    .where(eq(postings.accountId, sql.placeholder('accountId')))
    .prepare(),
  currenciesPostedTo: orm
    .selectDistinct({ currency: postings.currency })
    .from(postings)
    .where(eq(postings.accountId, sql.placeholder('accountId')))
    .orderBy(postings.currency)
    .prepare(),
  liveAccountAt: orm
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.pathKey, sql.placeholder('pathKey')), isNull(accounts.deletedAt)))
    .orderBy(accounts.originCreatedAt, accounts.id)
    .limit(1)
    .prepare(),
  pendingReferences: orm
    .selectDistinct({ transactionId: postings.transactionId, accountId: postings.accountId })
    .from(postings)
    .leftJoin(accounts, eq(accounts.id, postings.accountId))
    .where(isNull(accounts.id))
    .orderBy(postings.transactionId, postings.accountId)
    .prepare(),
}))

/**
 * Replaces whatever the file holds under this document's id. Its rows change together; inside a
 * caller's transaction this becomes a savepoint.
 */
export function putDocument(db: Database.Database, v: Versioned<LedgerDocument>): void {
  put(v.doc.type, db, v)
}

const put = <T extends DocumentTypeName>(
  type: T,
  db: Database.Database,
  v: Versioned<DocumentOf<T>>,
) => STORED_TYPES[type].put(db, v)

/** The document stored under `id`, tombstones included, or null if there is none of `type`. */
export function getDocument<T extends DocumentTypeName>(
  db: Database.Database,
  type: T,
  id: string,
): Versioned<DocumentOf<T>> | null {
  return STORED_TYPES[type].get(db, id)
}

/**
 * The live account at `path`, matched without regard to case. Sync can bring two; the one made
 * first wins, so every device picks the same.
 */
export function liveAccountAt(db: Database.Database, path: string): string | undefined {
  return statements(db).liveAccountAt.get({ pathKey: path.toLowerCase() })?.id
}

/** How many transactions post to this account. A tombstone has no postings, so all are live. */
export function countTransactionsUsing(db: Database.Database, accountId: string): number {
  return statements(db).transactionsUsing.get({ accountId })?.n ?? 0
}

/** The currencies posted to this account, sorted. A tombstone has no postings, so all are live. */
export function currenciesPostedTo(db: Database.Database, accountId: string): string[] {
  return statements(db)
    .currenciesPostedTo.all({ accountId })
    .map((r) => r.currency)
}

/**
 * Postings whose account the file doesn't hold yet: a received transaction can arrive before
 * its account. A query, never stored, so it clears itself when the account arrives.
 */
export function pendingReferences(
  db: Database.Database,
): { transactionId: string; accountId: string }[] {
  return statements(db).pendingReferences.all()
}
