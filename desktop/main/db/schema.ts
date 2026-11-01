import { ACCOUNT_KINDS } from '@have-fish/core/account-kind'
import type { OriginSource } from '@have-fish/core/documents'
import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// A column takes its name from its key, so the SQL names match the TypeScript ones.

/** What the file knows about itself: one row, written when the ledger is new. */
export const meta = sqliteTable(
  'meta',
  {
    id: integer().primaryKey(),
    /** Names this ledger. Minted once and never changed, even in a copy. */
    ledgerId: text().notNull(),
    /** The `deviceId` of every version this file issues. A copy on another machine gets a new one. */
    deviceId: text().notNull(),
    /** The install that minted `deviceId`. */
    installId: text().notNull(),
    /** The clock's last state. */
    clockWallMs: integer().notNull(),
    clockCounter: integer().notNull(),
    /** UTC ms. */
    createdAt: integer().notNull(),
  },
  (t) => [
    check('meta_one_row', sql`${t.id} = 1`),
    check(
      'meta_ledger_id',
      sql`length(${t.ledgerId}) = 32 AND ${t.ledgerId} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'meta_device_id',
      sql`length(${t.deviceId}) = 16 AND ${t.deviceId} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
)

/**
 * One row per account document. `deletedAt` set means a tombstone: the row stays, with its
 * version, so an older edit that arrives late can't bring the account back.
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: text().primaryKey(),
    path: text().notNull(),
    /** `path` lowercased, for lookups. Not unique: two devices can each make `assets:cash`. */
    pathKey: text().notNull(),
    /** `enum` types the column only. No CHECK: the list grows, and each change would rebuild the table. */
    kind: text({ enum: ACCOUNT_KINDS }).notNull(),
    /** UTC ms. */
    deletedAt: integer(),
    /** The version's text form, which sorts in version order. */
    version: text().notNull(),
    /** The document's `origin`, flattened so one import is a plain query. */
    originSource: text().$type<OriginSource>().notNull(),
    /** UTC ms. */
    originCreatedAt: integer().notNull(),
    originDeviceId: text().notNull(),
    /** Always null: nothing imports accounts. Kept so both tables read alike. */
    originFile: text(),
    originLine: integer(),
    originText: text(),
  },
  (t) => [index('accounts_path_key').on(t.pathKey)],
)

/** One row per transaction document. A tombstone keeps its row and has no postings. */
export const transactions = sqliteTable(
  'transactions',
  {
    id: text().primaryKey(),
    /** `YYYY-MM-DD`. */
    date: text().notNull(),
    description: text().notNull(),
    /** UTC ms. */
    deletedAt: integer(),
    /** The version's text form, which sorts in version order. */
    version: text().notNull(),
    /** The document's `origin`, flattened so one import is a plain query. */
    originSource: text().$type<OriginSource>().notNull(),
    /** UTC ms. */
    originCreatedAt: integer().notNull(),
    originDeviceId: text().notNull(),
    /** Null unless `originSource` is `import`. */
    originFile: text(),
    originLine: integer(),
    originText: text(),
  },
  (t) => [index('transactions_date').on(t.date)],
)

/** A transaction's postings, kept in the document's order by `position`. */
export const postings = sqliteTable(
  'postings',
  {
    transactionId: text()
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    /** The posting's index in the document's `postings`. */
    position: integer().notNull(),
    /** No foreign key: under sync, a transaction can arrive before its account. */
    accountId: text().notNull(),
    amountCents: integer().notNull(),
    currency: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.position] }),
    index('postings_account_id').on(t.accountId),
    // SQLite stores any value in any column, and a text amount would sum as a float.
    check('postings_amount_cents_integer', sql`typeof(${t.amountCents}) = 'integer'`),
  ],
)
