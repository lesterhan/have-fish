// A document and its rows, both ways. Pure: no database, so the tests need none.

import type {
  AccountDoc,
  AccountOrigin,
  RateDoc,
  TransactionDoc,
  TransactionOrigin,
} from '@have-fish/core/documents'
import { cents, format } from '@have-fish/core/money'
import { formatVersion, parseVersion, type Version } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import type { accounts, postings, rates, transactions } from '../db/schema'

export type AccountRow = typeof accounts.$inferSelect
export type TransactionRow = typeof transactions.$inferSelect
export type PostingRow = typeof postings.$inferSelect
export type RateRow = typeof rates.$inferSelect

/** The rows a transaction is stored as. */
export function transactionRows(v: Versioned<TransactionDoc>): {
  transaction: TransactionRow
  postings: PostingRow[]
} {
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
  return { transaction, postings }
}

/** The row an account is stored as. */
export function accountRows(v: Versioned<AccountDoc>): { account: AccountRow } {
  return {
    account: {
      id: v.doc.id,
      deletedAt: v.doc.deletedAt,
      path: v.doc.path,
      kind: v.doc.kind,
      currency: v.doc.currency,
      version: formatVersion(v.version),
      pathKey: v.doc.path.toLowerCase(),
      ...originColumns(v.doc.origin),
    },
  }
}

/** The row a rate is stored as: its text as it came, never a number. */
export function rateRows(v: Versioned<RateDoc>): { rate: RateRow } {
  return {
    rate: {
      id: v.doc.id,
      date: v.doc.date,
      fromCurrency: v.doc.from,
      toCurrency: v.doc.to,
      rate: v.doc.rate,
      published: v.doc.published,
      deletedAt: v.doc.deletedAt,
      version: formatVersion(v.version),
      ...originColumns(v.doc.origin),
    },
  }
}

/** The transaction its rows hold. */
export function transactionOf(
  row: TransactionRow,
  postings: PostingRow[],
): Versioned<TransactionDoc> {
  const version = versionOf(row)
  // Sorted, so the document's order doesn't depend on the order the rows were read in.
  const postingsDoc = postings
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
    version,
  }
}

/** The account its row holds. */
export function accountOf(row: AccountRow): Versioned<AccountDoc> {
  const version = versionOf(row)
  return {
    doc: {
      type: 'account',
      id: row.id,
      path: row.path,
      kind: row.kind,
      currency: row.currency,
      deletedAt: row.deletedAt,
      origin: accountOriginOf(row),
    },
    version,
  }
}

/** The rate its row holds. */
export function rateOf(row: RateRow): Versioned<RateDoc> {
  const version = versionOf(row)
  return {
    doc: {
      type: 'rate',
      id: row.id,
      date: row.date,
      from: row.fromCurrency,
      to: row.toCurrency,
      rate: row.rate,
      published: row.published,
      deletedAt: row.deletedAt,
      origin: accountOriginOf(row),
    },
    version,
  }
}

function versionOf(row: { id: string; version: string }): Version {
  const version = parseVersion(row.version)
  if (!version.ok)
    throw new Error(`Could not parse version: ${row.id} has ${JSON.stringify(row.version)}`)
  return version.value
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

/** An account's or a rate's origin: nothing imports either. */
function accountOriginOf(row: AccountRow | RateRow): AccountOrigin {
  const source = row.originSource
  if (source === 'import') throw new Error(`Could not read origin: ${row.id} is imported`)
  return { source, createdAt: row.originCreatedAt, deviceId: row.originDeviceId }
}
