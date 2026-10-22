// Opens the ledger file the same way every time: a private directory, crash-safe settings,
// migrations, and the meta row. Built up a step at a time.

import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { failure, type Outcome } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { type Migration, migrate } from './migrate'
import { MIGRATIONS } from './migrations'

export type Ledger = { db: Database.Database; close(): void }

export type OpenOptions = {
  /** The ledger directory; made private (0700) if it isn't. */
  dir: string
  /** This install's id. A file whose meta row names another install was copied here. */
  installId: string
  /** Defaults to the bundled ones; tests pass their own. */
  migrations?: readonly Migration[]
  /** UTC ms, recorded with each migration applied. */
  now: number
}

const LEDGER_FILE = 'ledger.sqlite'
/** "fish" in ASCII, in the file's header. Every ledger carries it, so it never changes. */
const APPLICATION_ID = 0x66697368

export function openLedger(options: OpenOptions): Outcome<Ledger> {
  mkdirSync(options.dir, { recursive: true, mode: 0o700 })
  chmodSync(options.dir, 0o700)
  const path = join(options.dir, LEDGER_FILE)
  const db = new Database(path)
  // `claim` is the first read, so a file that isn't SQLite fails there.
  try {
    if (!claim(db)) {
      db.close()
      return failure('LEDGER_UNREADABLE', { path })
    }
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
      options.migrations ?? MIGRATIONS,
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

/**
 * True if the file is a have-fish ledger. A new, empty file is stamped as one; any other SQLite
 * file is left exactly as it was.
 */
function claim(db: Database.Database): boolean {
  const id = db.pragma('application_id', { simple: true })
  if (id === APPLICATION_ID) return true
  const empty = db.prepare('SELECT count(*) FROM sqlite_master').pluck().get() === 0
  if (id !== 0 || !empty) return false
  db.pragma(`application_id = ${APPLICATION_ID}`)
  return true
}
