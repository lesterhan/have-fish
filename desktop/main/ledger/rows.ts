// A document and its rows, both ways. Pure: no database, so the tests need none.

import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { cents, format } from '@have-fish/core/money'
import { formatVersion, parseVersion } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import type { accounts, postings, transactions } from '../db/schema'

export type AccountRow = typeof accounts.$inferSelect
export type TransactionRow = typeof transactions.$inferSelect
export type PostingRow = typeof postings.$inferSelect

/** The rows a document is stored as. */
export function rowsOf(v: Versioned<TransactionDoc>): {
  transaction: TransactionRow
  postings: PostingRow[]
}
export function rowsOf(v: Versioned<AccountDoc>): { account: AccountRow }
export function rowsOf(
  v: Versioned<TransactionDoc> | Versioned<AccountDoc>,
): { transaction: TransactionRow; postings: PostingRow[] } | { account: AccountRow } {
  switch (v.doc.type) {
    case 'transaction': {
      const transaction = {
        id: v.doc.id,
        date: v.doc.date,
        description: v.doc.description,
        deletedAt: v.doc.deletedAt,
        version: formatVersion(v.version),
      }
      const postings = v.doc.postings.map((posting, position) => ({
        transactionId: v.doc.id,
        position,
        accountId: posting.accountId,
        amountCents: cents(posting.amount),
        currency: posting.currency,
      }))
      return {
        transaction,
        postings,
      }
    }

    case 'account': {
      throw new Error('not yet')
    }
  }
}

/** The document its rows hold. */
export function docOf(
  transaction: TransactionRow,
  postings: PostingRow[],
): Versioned<TransactionDoc>
export function docOf(account: AccountRow): Versioned<AccountDoc>
export function docOf(
  row: TransactionRow | AccountRow,
  postings?: PostingRow[],
): Versioned<TransactionDoc> | Versioned<AccountDoc> {
  const version = parseVersion(row.version)
  if (!version.ok)
    throw new Error(`Could not parse version: ${row.id} has ${JSON.stringify(row.version)}`)
  if ('kind' in row) {
    // AccountRow
    throw new Error('not yet')
  }
  // TransactionRow
  const postingsDoc = (postings ?? []).map((p) => ({
    accountId: p.accountId,
    amount: format(p.amountCents),
    currency: p.currency,
  }))
  return {
    doc: {
      type: 'transaction',
      id: row.id,
      date: row.date,
      description: row.description,
      postings: postingsDoc,
      deletedAt: row.deletedAt,
    },
    version: version.value,
  }
}
