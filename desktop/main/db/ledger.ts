// Opens the ledger file the same way every time: a private directory, crash-safe settings,
// migrations, and the meta row. Built up a step at a time.

import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { failure, type Outcome } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { type Migration, migrate } from './migrate'
import { MIGRATIONS } from './migrations'
import { meta } from './schema'

export type Ledger = { db: Database.Database; meta: Meta; close(): void }

/** What the file knows about itself. Not the clock: it changes with every write (`loadClock`). */
export type Meta = Pick<
  typeof meta.$inferSelect,
  'ledgerId' | 'deviceId' | 'installId' | 'createdAt'
>

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
    const ledgerMeta = upsertMetaRow(db, options.installId, options.now)
    return { ok: true, value: { db, meta: ledgerMeta, close: () => db.close() } }
  } catch (e) {
    db.close()
    throw e
  }
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

/** Writes a new file's meta row, or gives a file another install made a device id of its own. */
function upsertMetaRow(db: Database.Database, installId: string, now: number): Meta {
  const orm = drizzle(db)
  const metaRow = orm.select(META).from(meta).get()
  if (metaRow === undefined) {
    return orm
      .insert(meta)
      .values({
        ledgerId: randomBytes(16).toString('hex'),
        deviceId: newDeviceId(),
        installId,
        clockWallMs: 0,
        clockCounter: 0,
        createdAt: now,
      })
      .returning(META)
      .get()
  }
  if (metaRow.installId === installId) return metaRow
  // A copy, or a restore: the same ledger on another device. Two devices must never share an id.
  return orm.update(meta).set({ deviceId: newDeviceId(), installId }).returning(META).get()
}

/** The columns of `Meta`, for Drizzle to select and return. */
const META = {
  ledgerId: meta.ledgerId,
  deviceId: meta.deviceId,
  installId: meta.installId,
  createdAt: meta.createdAt,
}

const newDeviceId = () => randomBytes(8).toString('hex')
