// Writes a document as rows and reads it back. It stores what it is given: choosing which
// version wins, and checking accounts, happen before this is called.

import type { AccountDoc, LedgerDocument, TransactionDoc } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { countDistinct, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { accounts, postings, transactions } from '../db/schema'
import { docOf, rowsOf } from './rows'

/**
 * Replaces whatever the file holds under this document's id. A transaction's root row and
 * postings change together; inside a caller's transaction this becomes a savepoint.
 */
export function putDocument(db: Database.Database, v: Versioned<LedgerDocument>): void {
  const orm = drizzle(db)
  // Narrowing `doc` doesn't narrow `v`, so the overloads get a fresh envelope.
  const { doc, version } = v

  db.transaction(() => {
    if (doc.type === 'account') {
      const { account } = rowsOf({ doc, version })
      orm
        .insert(accounts)
        .values(account)
        .onConflictDoUpdate({ target: accounts.id, set: account })
        .run()
      return
    }

    const rows = rowsOf({ doc, version })
    orm
      .insert(transactions)
      .values(rows.transaction)
      .onConflictDoUpdate({ target: transactions.id, set: rows.transaction })
      .run()
    orm.delete(postings).where(eq(postings.transactionId, doc.id)).run()
    // Drizzle refuses an insert of no rows, and a tombstone has none.
    if (rows.postings.length > 0) orm.insert(postings).values(rows.postings).run()
  })()
}

/** The document stored under `id`, tombstones included, or null if there is none of `type`. */
export function getDocument(
  db: Database.Database,
  type: 'transaction',
  id: string,
): Versioned<TransactionDoc> | null
export function getDocument(
  db: Database.Database,
  type: 'account',
  id: string,
): Versioned<AccountDoc> | null
export function getDocument(
  db: Database.Database,
  type: LedgerDocument['type'],
  id: string,
): Versioned<LedgerDocument> | null
export function getDocument(
  db: Database.Database,
  type: LedgerDocument['type'],
  id: string,
): Versioned<LedgerDocument> | null {
  const orm = drizzle(db)
  if (type === 'account') {
    const account = orm.select().from(accounts).where(eq(accounts.id, id)).get()
    return account === undefined ? null : docOf(account)
  }

  const transaction = orm.select().from(transactions).where(eq(transactions.id, id)).get()
  if (transaction === undefined) return null
  // In any order: `docOf` sorts them by position.
  const rows = orm.select().from(postings).where(eq(postings.transactionId, id)).all()
  return docOf(transaction, rows)
}

/** How many transactions post to this account. A tombstone has no postings, so all are live. */
export function countTransactionsUsing(db: Database.Database, accountId: string): number {
  const row = drizzle(db)
    .select({ n: countDistinct(postings.transactionId) })
    .from(postings)
    .where(eq(postings.accountId, accountId))
    .get()
  return row?.n ?? 0
}

/**
 * Postings whose account the file doesn't hold yet: a received transaction can arrive before
 * its account. A query, never stored, so it clears itself when the account arrives.
 */
export function pendingReferences(
  db: Database.Database,
): { transactionId: string; accountId: string }[] {
  return drizzle(db)
    .selectDistinct({ transactionId: postings.transactionId, accountId: postings.accountId })
    .from(postings)
    .leftJoin(accounts, eq(accounts.id, postings.accountId))
    .where(isNull(accounts.id))
    .orderBy(postings.transactionId, postings.accountId)
    .all()
}
