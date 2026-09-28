import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator'
import {
  type Migration,
  migrateSqliteFile,
  readMigrations,
  SchemaTooNewError,
  SQLITE_MIGRATIONS,
} from './migrate'

// Stands alone: its own files and its own clients, never the app's database, so it runs the
// same under `bun test` and `bun run test:sqlite`.

const first: Migration = {
  tag: '0000_first',
  when: 1000,
  statements: ['CREATE TABLE item (id integer PRIMARY KEY, name text NOT NULL)'],
}
const second: Migration = {
  tag: '0001_second',
  when: 2000,
  statements: ['ALTER TABLE item ADD note text', 'CREATE INDEX item_name ON item (name)'],
}

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'havefish-migrate-'))
  file = join(dir, 'ledger.sqlite')
})

async function query(path: string, sql: string) {
  const client = createClient({ url: `file:${path}` })
  try {
    return (await client.execute(sql)).rows
  } finally {
    client.close()
  }
}

const recordedNames = async (path: string) =>
  (await query(path, 'SELECT name FROM __migrations ORDER BY name')).map((r) => r.name)

describe('migrateSqliteFile', () => {
  test('a new file gets every migration, recorded by name, and no backup', async () => {
    const result = await migrateSqliteFile(file, [first, second], {
      backupDir: join(dir, 'backups'),
    })
    expect(result).toEqual({ applied: ['0000_first', '0001_second'], backup: null })
    expect(await recordedNames(file)).toEqual(['0000_first', '0001_second'])
    expect(await query(file, 'SELECT note FROM item')).toEqual([])
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  test('a second run applies nothing and copies nothing', async () => {
    await migrateSqliteFile(file, [first, second])
    const result = await migrateSqliteFile(file, [first, second], {
      backupDir: join(dir, 'backups'),
    })
    expect(result).toEqual({ applied: [], backup: null })
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  test('a file with data is copied before a new migration, and the copy has the data', async () => {
    await migrateSqliteFile(file, [first])
    await query(file, "INSERT INTO item (name) VALUES ('kept')")

    const now = new Date('2026-09-28T12:34:56.789Z')
    const result = await migrateSqliteFile(file, [first, second], {
      backupDir: join(dir, 'backups'),
      now,
    })

    expect(result.applied).toEqual(['0001_second'])
    expect(result.backup).toBe(join(dir, 'backups', 'pre-migrate-2026-09-28T12-34-56-789Z.sqlite'))
    const backup = result.backup ?? ''
    // The copy is the file as it was: the row, and not the new column.
    expect(await query(backup, 'SELECT name FROM item')).toEqual([{ name: 'kept' }] as never)
    expect(await recordedNames(backup)).toEqual(['0000_first'])
    expect(await recordedNames(file)).toEqual(['0000_first', '0001_second'])
  })

  test('a file a newer build migrated is refused, untouched and uncopied', async () => {
    const third: Migration = { tag: '0002_third', when: 3000, statements: ['CREATE TABLE t (x)'] }
    await migrateSqliteFile(file, [first, second, third])

    const run = migrateSqliteFile(file, [first, second], { backupDir: join(dir, 'backups') })
    await expect(run).rejects.toBeInstanceOf(SchemaTooNewError)
    expect(await recordedNames(file)).toEqual(['0000_first', '0001_second', '0002_third'])
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  test('a migration that fails leaves the file as it was', async () => {
    await migrateSqliteFile(file, [first])
    const broken: Migration = {
      tag: '0001_broken',
      when: 2000,
      statements: ['CREATE TABLE made (x)', 'ALTER TABLE missing ADD y text'],
    }
    await expect(migrateSqliteFile(file, [first, broken])).rejects.toThrow()
    expect(await recordedNames(file)).toEqual(['0000_first'])
    expect(await query(file, "SELECT name FROM sqlite_master WHERE name = 'made'")).toEqual([])
  })
})

describe("a file drizzle's migrator applied (#287's launcher)", () => {
  test('is adopted: its migrations are recorded by name and not run again', async () => {
    const client = createClient({ url: `file:${file}` })
    await drizzleMigrate(drizzle(client), { migrationsFolder: SQLITE_MIGRATIONS })
    client.close()

    const all = readMigrations()
    const result = await migrateSqliteFile(file, all, { backupDir: join(dir, 'backups') })
    expect(result).toEqual({ applied: [], backup: null })
    expect(await recordedNames(file)).toEqual(all.map((m) => m.tag))
    expect(await migrateSqliteFile(file, all)).toEqual({ applied: [], backup: null })
  })

  test('is refused when drizzle recorded a migration this build does not have', async () => {
    await query(
      file,
      'CREATE TABLE __drizzle_migrations (id integer, hash text, created_at numeric)',
    )
    await query(file, "INSERT INTO __drizzle_migrations VALUES (1, 'x', 9999999999999)")
    await expect(migrateSqliteFile(file, readMigrations())).rejects.toBeInstanceOf(
      SchemaTooNewError,
    )
  })
})

describe('readMigrations', () => {
  test("reads the journal's order and splits each file at drizzle's breakpoints", () => {
    const all = readMigrations()
    const files = readdirSync(SQLITE_MIGRATIONS).filter((f) => f.endsWith('.sql'))
    expect(all.map((m) => `${m.tag}.sql`)).toEqual(files.sort())
    for (const m of all) {
      expect(m.statements.length).toBeGreaterThan(0)
      for (const s of m.statements) expect(s).not.toContain('statement-breakpoint')
    }
  })
})
