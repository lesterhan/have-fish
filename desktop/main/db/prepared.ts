// Drizzle on better-sqlite3 prepares a query's SQL on every call, which costs more than running
// it. A module builds its queries here once per open file, and reuses them.

import type Database from 'better-sqlite3'
import { getTableColumns, sql } from 'drizzle-orm'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import type { SQLiteInsertValue, SQLiteTable, SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core'

/**
 * The statements `make` builds, the first time a connection asks for them, and the same ones
 * after. Kept per connection, because a statement belongs to the one that prepared it. `db` is
 * for SQL Drizzle can't say, such as a row-value comparison.
 */
export function perConnection<T>(
  make: (orm: BetterSQLite3Database, db: Database.Database) => T,
): (db: Database.Database) => T {
  const built = new WeakMap<Database.Database, T>()
  return (db) => {
    let statements = built.get(db)
    if (statements === undefined) {
      statements = make(drizzle(db), db)
      built.set(db, statements)
    }
    return statements
  }
}

/** A placeholder for every column, named by its key, so `run(row)` inserts the whole row. */
export function placeholderRow<T extends SQLiteTable>(table: T): SQLiteInsertValue<T> {
  const keys = Object.keys(getTableColumns(table))
  return Object.fromEntries(keys.map((key) => [key, sql.placeholder(key)])) as SQLiteInsertValue<T>
}

/** For an upsert: on conflict, every column takes the row that was being inserted. */
export function excludedRow<T extends SQLiteTable>(table: T): SQLiteUpdateSetSource<T> {
  const columns = Object.entries(getTableColumns(table))
  return Object.fromEntries(
    columns.map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
  ) as SQLiteUpdateSetSource<T>
}
