// Writes a document as rows and reads it back. It stores what it is given: choosing which
// version wins, and checking accounts, happen before this is called.

import type { AccountDoc, LedgerDocument, TransactionDoc } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { countDistinct, eq, isNull, sql } from 'drizzle-orm'
import { excludedRow, perConnection, placeholderRow } from '../db/prepared'
import { accounts, postings, transactions } from '../db/schema'
import { docOf, rowsOf } from './rows'

const statements = perConnection((orm) => ({
  putAccount: orm
    .insert(accounts)
    .values(placeholderRow(accounts))
    .onConflictDoUpdate({ target: accounts.id, set: excludedRow(accounts) })
    .prepare(),
  putTransaction: orm
    .insert(transactions)
    .values(placeholderRow(transactions))
    .onConflictDoUpdate({ target: transactions.id, set: excludedRow(transactions) })
    .prepare(),
  deletePostings: orm
    .delete(postings)
    .where(eq(postings.transactionId, sql.placeholder('transactionId')))
    .prepare(),
  insertPosting: orm.insert(postings).values(placeholderRow(postings)).prepare(),
  account: orm
    .select()
    .from(accounts)
    .where(eq(accounts.id, sql.placeholder('id')))
    .prepare(),
  transaction: orm
    .select()
    .from(transactions)
    .where(eq(transactions.id, sql.placeholder('id')))
    .prepare(),
  postingsOf: orm
    .select()
    .from(postings)
    .where(eq(postings.transactionId, sql.placeholder('transactionId')))
    .prepare(),
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
  pendingReferences: orm
    .selectDistinct({ transactionId: postings.transactionId, accountId: postings.accountId })
    .from(postings)
    .leftJoin(accounts, eq(accounts.id, postings.accountId))
    .where(isNull(accounts.id))
    .orderBy(postings.transactionId, postings.accountId)
    .prepare(),
}))

/**
 * Replaces whatever the file holds under this document's id. A transaction's root row and
 * postings change together; inside a caller's transaction this becomes a savepoint.
 */
export function putDocument(db: Database.Database, v: Versioned<LedgerDocument>): void {
  const s = statements(db)
  // Narrowing `doc` doesn't narrow `v`, so the overloads get a fresh envelope.
  const { doc, version } = v

  db.transaction(() => {
    if (doc.type === 'account') {
      s.putAccount.run(rowsOf({ doc, version }).account)
      return
    }

    const rows = rowsOf({ doc, version })
    s.putTransaction.run(rows.transaction)
    s.deletePostings.run({ transactionId: doc.id })
    for (const posting of rows.postings) s.insertPosting.run(posting)
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
  const s = statements(db)
  if (type === 'account') {
    const account = s.account.get({ id })
    return account === undefined ? null : docOf(account)
  }

  const transaction = s.transaction.get({ id })
  if (transaction === undefined) return null
  // In any order: `docOf` sorts them by position.
  return docOf(transaction, s.postingsOf.all({ transactionId: id }))
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
