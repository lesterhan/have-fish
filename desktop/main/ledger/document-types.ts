// Each type of document as the ledger file holds it: its rows, its local checks, and the list an
// undo of it moves. A new type is one entry here, beside its entry in core's `DOCUMENT_TYPES`.

import type {
  AccountDoc,
  DocumentOf,
  DocumentTypeName,
  LedgerDocument,
  TransactionDoc,
} from '@have-fish/core/documents'
import type { Failure } from '@have-fish/core/outcome'
import type { Versioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import type { Moved } from '../../shared/commands'
import { excludedRow, perConnection, placeholderRow } from '../db/prepared'
import { accounts, postings, transactions } from '../db/schema'
import type { Refusal } from './apply'
import { accountOf, accountRows, transactionOf, transactionRows } from './rows'
import { countTransactionsUsing, currenciesPostedTo } from './store'

/** One document a local batch wrote, where it was in the batch, and what it replaced. */
export type WrittenItem<D extends LedgerDocument> = { at: number; doc: D; previous: D | null }

export type StoredType<D extends LedgerDocument> = {
  /** Writes its rows; inside a caller's transaction they are one savepoint. */
  put(db: Database.Database, v: Versioned<D>): void
  /** The document stored under `id`, tombstones included, or null. */
  get(db: Database.Database, id: string): Versioned<D> | null
  /** A local write's check, before it's stored. */
  checkEach(db: Database.Database, at: number, doc: D): Failure | null
  /** Run once after a local batch, over the items of this type it wrote. */
  checkBatch(db: Database.Database, written: WrittenItem<D>[]): Refusal | null
  /** The list an undo or redo of it moves. */
  shows: keyof Moved
}

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
}))

export const STORED_TYPES: { [T in DocumentTypeName]: StoredType<DocumentOf<T>> } = {
  account: {
    put: (db, v) => statements(db).putAccount.run(accountRows(v).account),
    get: getAccount,
    checkEach: () => null,
    checkBatch: checkAccounts,
    shows: 'accounts',
  },
  transaction: {
    put: putTransaction,
    get: getTransaction,
    checkEach: (db, _at, doc) => checkPostedAccounts(db, doc),
    checkBatch: () => null,
    shows: 'spends',
  },
}

function getAccount(db: Database.Database, id: string): Versioned<AccountDoc> | null {
  const account = statements(db).account.get({ id })
  return account === undefined ? null : accountOf(account)
}

/** Its root row and postings change together. */
function putTransaction(db: Database.Database, v: Versioned<TransactionDoc>): void {
  const s = statements(db)
  const rows = transactionRows(v)
  db.transaction(() => {
    s.putTransaction.run(rows.transaction)
    s.deletePostings.run({ transactionId: v.doc.id })
    for (const posting of rows.postings) s.insertPosting.run(posting)
  })()
}

function getTransaction(db: Database.Database, id: string): Versioned<TransactionDoc> | null {
  const s = statements(db)
  const transaction = s.transaction.get({ id })
  if (transaction === undefined) return null
  // In any order: `transactionOf` sorts them by position.
  return transactionOf(transaction, s.postingsOf.all({ transactionId: id }))
}

/** A local posting points at an account this file holds, that is live, in a currency it takes. */
function checkPostedAccounts(db: Database.Database, doc: TransactionDoc): Failure | null {
  for (const accountId of new Set(doc.postings.map((p) => p.accountId))) {
    const account = getAccount(db, accountId)
    if (account === null) return { code: 'ACCOUNT_NOT_FOUND', details: { accountId } }
    if (account.doc.deletedAt !== null) return { code: 'ACCOUNT_DELETED', details: { accountId } }
    const locked = account.doc.currency
    if (locked === null) continue
    const other = doc.postings.find((p) => p.accountId === accountId && p.currency !== locked)
    if (other !== undefined) {
      return {
        code: 'ACCOUNT_CURRENCY_LOCKED',
        details: { accountId, currency: other.currency, locked },
      }
    }
  }
  return null
}

/**
 * After the whole batch, so deleting an account with the transactions that used it succeeds, and
 * so does locking one in the batch that moves its other currencies off it.
 */
function checkAccounts(db: Database.Database, written: WrittenItem<AccountDoc>[]): Refusal | null {
  for (const { at, doc } of written) {
    if (doc.deletedAt === null) continue
    const transactions = countTransactionsUsing(db, doc.id)
    if (transactions > 0) {
      return { at, code: 'ACCOUNT_IN_USE', details: { accountId: doc.id, transactions } }
    }
  }

  // Only a lock the batch sets, and its last word on each account: a rename keeps the lock.
  const locks = new Map<string, { at: number; locked: string }>()
  for (const { at, doc, previous } of written) {
    if (doc.currency === null) locks.delete(doc.id)
    else if (doc.currency !== (previous?.currency ?? null)) {
      locks.set(doc.id, { at, locked: doc.currency })
    }
  }
  for (const [accountId, { at, locked }] of locks) {
    const currencies = currenciesPostedTo(db, accountId).filter((c) => c !== locked)
    if (currencies.length > 0) {
      return { at, code: 'ACCOUNT_HOLDS_OTHER_CURRENCIES', details: { accountId, currencies } }
    }
  }
  return null
}
