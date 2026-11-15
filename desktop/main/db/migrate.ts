import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { failure, type Outcome } from '@have-fish/core/outcome'
import type Database from 'better-sqlite3'

/** One migration: its name, and the SQL statements drizzle-kit generated for it. */
export type Migration = { tag: string; statements: string[] }

const TABLE = '__migrations'
/**
 * Where a copy is made until it is whole: never a backup's name, so a partial one isn't taken for
 * one.
 */
const PARTIAL = 'copying.partial'
/** How much of each file a comparison holds at once. */
const CHUNK = 1024 * 1024

/**
 * Applies the migrations the file hasn't had yet, in order, and returns their tags. A file that
 * records a migration this build lacks is refused before anything is written. A file that holds
 * data is copied into `backupDir` before the first pending migration, once while it stays as it
 * was.
 */
export function migrate(
  db: Database.Database,
  migrations: readonly Migration[],
  now: number,
  backupDir: string,
): Outcome<string[]> {
  const done = recorded(db)
  const known = new Set(migrations.map((m) => m.tag))
  const unknown = [...done].filter((tag) => !known.has(tag))
  // A newer build migrated this file; an older one must not write to it.
  if (unknown.length > 0) return failure('LEDGER_TOO_NEW', { path: db.name, unknown })

  const pending = migrations.filter((m) => !done.has(m.tag))
  const [next] = pending
  // A new file has nothing to lose, so only one with migrations already in it is copied.
  if (next !== undefined && done.size > 0) backup(db, backupDir, now, next.tag)

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

/**
 * Copies the file through SQLite, never with `fs`: a byte copy would miss commits still in the
 * WAL. `VACUUM INTO` is synchronous, unlike better-sqlite3's `backup()`. It is made under PARTIAL
 * and renamed once whole, and dropped if a copy kept before `tag` holds the same bytes.
 */
function backup(db: Database.Database, dir: string, now: number, tag: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const partial = join(dir, PARTIAL)
  // A crash part-way leaves one, and VACUUM INTO won't write over a file.
  rmSync(partial, { force: true })
  try {
    db.prepare('VACUUM INTO ?').run(partial)
    const suffix = `-before-${tag}.sqlite`
    const kept = readdirSync(dir).filter(
      (name) => name.startsWith('ledger-') && name.endsWith(suffix),
    )
    if (kept.some((name) => sameBytes(join(dir, name), partial))) return
    // No colons, which some file systems refuse.
    const time = new Date(now).toISOString().replace(/[:.]/g, '-')
    const name = `ledger-${time}${suffix}`
    // A rename would replace a copy kept under that name.
    if (existsSync(join(dir, name))) throw new Error(`${name} is already there, and differs`)
    renameSync(partial, join(dir, name))
  } finally {
    rmSync(partial, { force: true })
  }
}

/**
 * True if the two files hold the same bytes, read a chunk at a time. A short read counts as
 * different.
 */
function sameBytes(a: string, b: string): boolean {
  const size = statSync(a).size
  if (statSync(b).size !== size) return false
  const fa = openSync(a, 'r')
  const fb = openSync(b, 'r')
  try {
    const ba = Buffer.alloc(CHUNK)
    const bb = Buffer.alloc(CHUNK)
    for (let at = 0; at < size; at += CHUNK) {
      const n = Math.min(CHUNK, size - at)
      if (readSync(fa, ba, 0, n, at) !== n || readSync(fb, bb, 0, n, at) !== n) return false
      if (!ba.subarray(0, n).equals(bb.subarray(0, n))) return false
    }
    return true
  } finally {
    closeSync(fa)
    closeSync(fb)
  }
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
