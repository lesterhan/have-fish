import { failure, type Outcome } from '@have-fish/core/outcome'
import type Database from 'better-sqlite3'

/** One migration: its name, and the SQL statements drizzle-kit generated for it. */
export type Migration = { tag: string; statements: string[] }

const TABLE = '__migrations'

/**
 * Applies the migrations the file hasn't had yet, in order, and returns their tags. A file that
 * records a migration this build lacks is refused before anything is written.
 */
export function migrate(
  db: Database.Database,
  migrations: readonly Migration[],
  now: number,
): Outcome<string[]> {
  const done = recorded(db)
  const known = new Set(migrations.map((m) => m.tag))
  const unknown = [...done].filter((tag) => !known.has(tag))
  // A newer build migrated this file; an older one must not write to it.
  if (unknown.length > 0) return failure('LEDGER_TOO_NEW', { path: db.name, unknown })

  const pending = migrations.filter((m) => !done.has(m.tag))

  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    tag TEXT PRIMARY KEY NOT NULL,
    appliedAt INTEGER NOT NULL
  )`)
  const record = db.prepare(`INSERT INTO ${TABLE} (tag, appliedAt) VALUES (?, ?)`)

  for (const migration of pending) {
    // A table rebuild needs foreign keys off, and SQLite ignores that pragma inside a transaction.
    db.pragma('foreign_keys = OFF')
    try {
      // The migration and its row commit together as a transaction.
      db.transaction(() => {
        for (const sql of migration.statements) db.exec(sql)
        checkForeignKeys(db, migration.tag)
        record.run(migration.tag, now)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }
  return { ok: true, value: pending.map((m) => m.tag) }
}

/** The tags the file says it has. A new file has none. */
function recorded(db: Database.Database): Set<string> {
  const table = db
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(TABLE)
  if (table === undefined) return new Set()
  const rows = db.prepare<[], { tag: string }>(`SELECT tag FROM ${TABLE}`).all()
  return new Set(rows.map((r) => r.tag))
}

/** Throws, rolling the migration back, if it left a row pointing at nothing. */
function checkForeignKeys(db: Database.Database, tag: string): void {
  const broken = db.pragma('foreign_key_check') as { table: string }[]
  if (broken.length === 0) return
  const tables = [...new Set(broken.map((row) => row.table))].join(', ')
  throw new Error(`${tag} left rows in ${tables} pointing at nothing`)
}
