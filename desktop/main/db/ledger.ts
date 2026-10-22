// Opens the ledger file the same way every time: a private directory, crash-safe settings,
// migrations, and the meta row. Built up a step at a time.

import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { failure, type Outcome } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { type Migration, migrate } from './migrate'

export type Ledger = { db: Database.Database; close(): void }

export type OpenOptions = {
  /** The ledger directory; made private (0700) if it isn't. */
  dir: string
  /** Defaults to the bundled ones, once the first migration lands. */
  migrations?: readonly Migration[]
  /** UTC ms, recorded with each migration applied. */
  now: number
}

const LEDGER_FILE = 'ledger.sqlite'

export function openLedger(options: OpenOptions): Outcome<Ledger> {
  mkdirSync(options.dir, { recursive: true, mode: 0o700 })
  chmodSync(options.dir, 0o700)
  const path = join(options.dir, LEDGER_FILE)
  const db = new Database(path)
  // The first pragma is the first read, so a file that isn't SQLite fails here.
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
  } catch (e) {
    db.close()
    if (e instanceof Database.SqliteError && e.code === 'SQLITE_NOTADB') {
      return failure('LEDGER_UNREADABLE', { path })
    }
    throw e
  }

  try {
    const migrated = migrate(
      db,
      options.migrations ?? [],
      options.now,
      join(options.dir, 'backups'),
    )
    if (!migrated.ok) {
      db.close()
      return migrated
    }
  } catch (e) {
    db.close()
    throw e
  }
  return { ok: true, value: { db, close: () => db.close() } }
}
