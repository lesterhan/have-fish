import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
