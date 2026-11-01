// A document and its rows, both ways. Pure: no database, so the tests need none.

import type {
  AccountDoc,
  AccountOrigin,
  TransactionDoc,
  TransactionOrigin,
} from '@have-fish/core/documents'
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
        ...originColumns(v.doc.origin),
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
      return {
        account: {
          id: v.doc.id,
          deletedAt: v.doc.deletedAt,
          path: v.doc.path,
          kind: v.doc.kind,
          version: formatVersion(v.version),
          pathKey: v.doc.path.toLowerCase(),
          ...originColumns(v.doc.origin),
        },
      }
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
    return {
      doc: {
        type: 'account',
        id: row.id,
        path: row.path,
        kind: row.kind,
        deletedAt: row.deletedAt,
        origin: accountOriginOf(row),
      },
      version: version.value,
    }
  }
  // TransactionRow
  // Sorted, so the document's order doesn't depend on the order the rows were read in.
  const postingsDoc = (postings ?? [])
    .toSorted((a, b) => a.position - b.position)
    .map((p) => ({
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
      origin: originOf(row),
    },
    version: version.value,
  }
}

/** An origin as its columns. The last three are null unless it's an import. */
function originColumns(origin: TransactionOrigin) {
  const imported = origin.source === 'import' ? origin : null
  return {
    originSource: origin.source,
    originCreatedAt: origin.createdAt,
    originDeviceId: origin.deviceId,
    originFile: imported?.file ?? null,
    originLine: imported?.line ?? null,
    originText: imported?.text ?? null,
  }
}

function originOf(row: TransactionRow): TransactionOrigin {
  const made = { createdAt: row.originCreatedAt, deviceId: row.originDeviceId }
  if (row.originSource !== 'import') return { source: row.originSource, ...made }

  const { originFile: file, originLine: line, originText: text } = row
  if (file === null || line === null || text === null) {
    throw new Error(`Could not read origin: ${row.id} is an import without its file, line or text`)
  }
  return { source: 'import', ...made, file, line, text }
}

function accountOriginOf(row: AccountRow): AccountOrigin {
  const source = row.originSource
  if (source === 'import') throw new Error(`Could not read origin: ${row.id} is imported`)
  return { source, createdAt: row.originCreatedAt, deviceId: row.originDeviceId }
}
