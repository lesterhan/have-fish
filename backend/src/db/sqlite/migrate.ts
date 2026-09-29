// Brings a SQLite database file up to the schema this build knows (#288). Used by the local
// launcher on every start (`local/launch.ts`), by the SQLite test run (`test-preload.ts`) and by
// `db:migrate:sqlite`, each with a client of its own that is closed afterwards, so the app's
// client first opens a migrated file.
//
// Not drizzle's migrator: that one reads the SQL from a folder at run time, and a compiled
// binary has no folder. This one is handed the migrations as a list, which the binary carries
// as strings (`scripts/build-binary.ts`) and every other caller reads with `readMigrations`.
// It records each by name in `__migrations`, and it refuses a file that records a name it
// does not know: that file was opened by a newer build, and an older one must not write to it.

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Client, createClient } from '@libsql/client'

export const SQLITE_MIGRATIONS = join(import.meta.dir, '../../../drizzle/sqlite')

/** One generated migration: its name, when drizzle-kit generated it, and its statements. */
export type Migration = { tag: string; when: number; statements: string[] }

/** The migrations in `folder`, in the order drizzle-kit's journal lists them. */
export function readMigrations(folder = SQLITE_MIGRATIONS): Migration[] {
  const journal: { entries: { tag: string; when: number }[] } = JSON.parse(
    readFileSync(join(folder, 'meta/_journal.json'), 'utf8'),
  )
  return journal.entries.map(({ tag, when }) => ({
    tag,
    when,
    statements: readFileSync(join(folder, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean),
  }))
}

/** The file records migrations this build does not have. Nothing was written to it. */
export class SchemaTooNewError extends Error {
  constructor(readonly path: string) {
    super(
      `${path} was last opened by a newer have-fish, and this one does not know its schema. ` +
        'Nothing was changed. Run the newer version, or restore a copy from the backups folder.',
    )
    this.name = 'SchemaTooNewError'
  }
}

export type MigrateOptions = {
  /** Where to copy the file before migrating one that already holds data. */
  backupDir?: string
  now?: Date
}

export type MigrateResult = {
  /** The migrations this run applied, in order. */
  applied: string[]
  /** The copy taken first, or null when nothing needed one. */
  backup: string | null
}

const TABLE = '__migrations'

export async function migrateSqliteFile(
  path: string,
  migrations: readonly Migration[],
  { backupDir, now = new Date() }: MigrateOptions = {},
): Promise<MigrateResult> {
  const client = createClient({ url: `file:${path}` })
  try {
    const { done, adopted } = await recorded(client, path, migrations)
    const pending = migrations.filter((m) => !done.has(m.tag))
    if (pending.length === 0 && adopted.length === 0) return { applied: [], backup: null }

    // A file with no migrations in it has nothing to lose, so only one with data is copied.
    let backup: string | null = null
    if (backupDir && done.size > 0 && pending.length > 0) {
      mkdirSync(backupDir, { recursive: true, mode: 0o700 })
      backup = join(backupDir, `pre-migrate-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`)
      // A copy through SQLite rather than of the bytes: it carries what is still in the WAL.
      await client.execute({ sql: 'VACUUM INTO ?', args: [backup] })
    }

    const record = (tag: string) => ({
      sql: `INSERT INTO ${TABLE} (name, applied_at) VALUES (?, ?)`,
      args: [tag, now.getTime()],
    })
    // One transaction, foreign keys off (libsql's `migrate`), so a failure leaves the file as
    // it was and a table rebuild cannot trip over its own references.
    await client.migrate([
      `CREATE TABLE IF NOT EXISTS ${TABLE} (name text PRIMARY KEY NOT NULL, applied_at integer NOT NULL)`,
      ...adopted.map(record),
      ...pending.flatMap((m) => [...m.statements, record(m.tag)]),
    ])
    return { applied: pending.map((m) => m.tag), backup }
  } finally {
    client.close()
  }
}

async function tableExists(client: Client, name: string): Promise<boolean> {
  const rows = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [name],
  })
  return rows.rows.length > 0
}

/**
 * The migrations the file says it has, and any to record that drizzle's migrator applied. A
 * file that #287's launcher migrated carries `__drizzle_migrations` instead, which stores when
 * each was generated rather than its name; those map back onto the journal by that time.
 */
async function recorded(
  client: Client,
  path: string,
  migrations: readonly Migration[],
): Promise<{ done: Set<string>; adopted: string[] }> {
  const known = new Set(migrations.map((m) => m.tag))
  if (await tableExists(client, TABLE)) {
    const rows = await client.execute(`SELECT name FROM ${TABLE}`)
    const done = new Set(rows.rows.map((r) => String(r.name)))
    if ([...done].some((tag) => !known.has(tag))) throw new SchemaTooNewError(path)
    return { done, adopted: [] }
  }
  if (await tableExists(client, '__drizzle_migrations')) {
    const rows = await client.execute('SELECT max(created_at) AS last FROM __drizzle_migrations')
    const last = Number(rows.rows[0]?.last ?? 0)
    const adopted = migrations.filter((m) => m.when <= last).map((m) => m.tag)
    if (migrations.every((m) => m.when !== last) && last > 0) throw new SchemaTooNewError(path)
    return { done: new Set(adopted), adopted }
  }
  return { done: new Set(), adopted: [] }
}
