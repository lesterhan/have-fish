import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { failure } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type Ledger, type OpenOptions, openLedger } from './ledger'
import type { Migration } from './migrate'
import { MIGRATIONS } from './migrations'
import { meta } from './schema'

const NOW = Date.UTC(2026, 9, 22, 12)
const INSTALL = 'install-a'

// Each test gets a fresh temp folder, deleted afterwards.
let root: string
const opened: Ledger[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'havefish-ledger-'))
})

afterEach(() => {
  for (const ledger of opened.splice(0)) ledger.close()
  rmSync(root, { recursive: true, force: true })
})

/**
 * Opens a ledger that is closed after the test, as `INSTALL` unless told otherwise. A refusal
 * fails the test.
 */
function open(options: Omit<OpenOptions, 'now' | 'installId'> & { installId?: string }): Ledger {
  const result = openLedger({ now: NOW, installId: INSTALL, ...options })
  if (!result.ok) throw new Error(`refused: ${result.failure.code}`)
  opened.push(result.value)
  return result.value
}

test('makes a missing directory, readable by you alone', () => {
  const dir = join(root, 'ledger')
  open({ dir })
  expect(statSync(dir).mode & 0o777).toBe(0o700)
})

test('tightens permission of existing directory to readable by you alone', () => {
  const dir = join(root, 'ledger')
  mkdirSync(dir, { recursive: true, mode: 0o755 })
  open({ dir })
  expect(statSync(dir).mode & 0o777).toBe(0o700)
})

test('creates a ledger db file', () => {
  const dir = join(root, 'ledger')
  open({ dir })
  expect(existsSync(join(dir, 'ledger.sqlite'))).toBeTruthy()
})

test('pragmas are set properly', () => {
  const ledger = open({ dir: join(root, 'ledger') })
  expect(ledger.db.pragma('journal_mode', { simple: true })).toBe('wal')
  expect(ledger.db.pragma('synchronous', { simple: true })).toBe(2)
  expect(ledger.db.pragma('foreign_keys', { simple: true })).toBe(1)
  expect(ledger.db.pragma('busy_timeout', { simple: true })).toBe(5000)
})

test('a reopened file is still synchronous FULL', () => {
  // This build of better-sqlite3 reopens a WAL file at NORMAL (1), so the pragma must be set.
  const dir = join(root, 'ledger')
  open({ dir }).close()
  const reopened = open({ dir })
  expect(reopened.db.pragma('synchronous', { simple: true })).toBe(2)
})

describe('only a have-fish ledger is opened', () => {
  test("a new file is stamped with have-fish's application id", () => {
    const ledger = open({ dir: join(root, 'ledger') })
    // "fish" in ASCII. Never change it: every existing ledger carries it.
    expect(ledger.db.pragma('application_id', { simple: true })).toBe(0x66697368)
  })

  /** Makes `ledger.sqlite` with another app's SQLite file, and returns its bytes. */
  function otherApp(make: (db: Database.Database) => void): {
    dir: string
    file: string
    bytes: Buffer
  } {
    const dir = join(root, 'ledger')
    const file = join(dir, 'ledger.sqlite')
    mkdirSync(dir)
    const db = new Database(file)
    make(db)
    db.close()
    return { dir, file, bytes: readFileSync(file) }
  }

  test('refuses an SQLite file with no id and tables of its own, and leaves it as it was', () => {
    const { dir, file, bytes } = otherApp((db) => db.exec('CREATE TABLE notes (body TEXT)'))

    expect(openLedger({ dir, installId: INSTALL, now: NOW })).toEqual(
      failure('LEDGER_UNREADABLE', { path: file }),
    )
    expect(readFileSync(file).equals(bytes)).toBe(true)
    expect(existsSync(`${file}-wal`)).toBe(false)
  })

  test("refuses an SQLite file with another app's id, and leaves it as it was", () => {
    const { dir, file, bytes } = otherApp((db) => db.pragma('application_id = 305419896'))

    expect(openLedger({ dir, installId: INSTALL, now: NOW })).toEqual(
      failure('LEDGER_UNREADABLE', { path: file }),
    )
    expect(readFileSync(file).equals(bytes)).toBe(true)
  })
})

test('refuses a file that is not SQLite, and leaves it as it was', () => {
  const dir = join(root, 'ledger')
  const file = join(dir, 'ledger.sqlite')
  mkdirSync(dir)
  const garbage = randomBytes(4096)
  writeFileSync(file, garbage)

  expect(openLedger({ dir, installId: INSTALL, now: NOW })).toEqual(
    failure('LEDGER_UNREADABLE', { path: file }),
  )
  expect(readFileSync(file).equals(garbage)).toBe(true)
})

describe('migrations', () => {
  const first: Migration = { tag: '0000_first', statements: ['CREATE TABLE item (x)'] }
  const later: Migration = { tag: '0001_later', statements: ['CREATE TABLE later (x)'] }
  // After the bundled ones, as a real file's next migrations would be.
  const upToFirst = [...MIGRATIONS, first]
  const upToLater = [...MIGRATIONS, first, later]

  test('with no migrations given, a ledger gets the bundled ones', () => {
    const ledger = open({ dir: join(root, 'ledger') })
    expect(ledger.db.prepare('SELECT tag FROM __migrations ORDER BY rowid').pluck().all()).toEqual(
      MIGRATIONS.map((m) => m.tag),
    )
    expect(tables(ledger.db)).toContain('meta')
  })

  test('opening applies the migrations it is given', () => {
    const ledger = open({ dir: join(root, 'ledger'), migrations: upToFirst })
    expect(ledger.db.prepare('SELECT tag FROM __migrations ORDER BY rowid').pluck().all()).toEqual(
      upToFirst.map((m) => m.tag),
    )
  })

  test('a file a newer build migrated is refused, and its bytes are unchanged', () => {
    const dir = join(root, 'ledger')
    const file = join(dir, 'ledger.sqlite')
    open({ dir, migrations: upToLater }).close()
    const before = readFileSync(file)

    expect(openLedger({ dir, installId: INSTALL, migrations: upToFirst, now: NOW })).toEqual(
      failure('LEDGER_TOO_NEW', { path: file, unknown: ['0001_later'] }),
    )
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  /** Opens a copy read-only, runs `read` on it, and closes it. */
  function inCopy<T>(path: string, read: (copy: Database.Database) => T): T {
    const copy = new Database(path, { readonly: true })
    try {
      return read(copy)
    } finally {
      copy.close()
    }
  }
  const tables = (db: Database.Database) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all()

  test('a new migration is preceded by one backup, private, with the old schema', () => {
    const dir = join(root, 'ledger')
    const ledger = open({ dir, migrations: upToFirst })
    ledger.db.prepare('INSERT INTO item VALUES (1)').run()
    ledger.close()

    const live = open({ dir, migrations: upToLater })

    const backups = join(dir, 'backups')
    expect(statSync(backups).mode & 0o777).toBe(0o700)
    expect(readdirSync(backups)).toEqual([
      'ledger-2026-10-22T12-00-00-000Z-before-0001_later.sqlite',
    ])
    const backup = join(backups, readdirSync(backups)[0] ?? '')
    expect(inCopy(backup, tables)).toEqual(['__migrations', 'item', 'meta'])
    expect(inCopy(backup, (copy) => copy.prepare('SELECT x FROM item').pluck().all())).toEqual([1])
    expect(tables(live.db)).toEqual(['__migrations', 'item', 'later', 'meta'])
  })

  test('a backup can be put back as the ledger and opened', () => {
    const dir = join(root, 'ledger')
    const ledger = open({ dir, migrations: upToFirst })
    ledger.db.prepare('INSERT INTO item VALUES (1)').run()
    ledger.close()
    open({ dir, migrations: upToLater }).close()
    const backup = join(dir, 'backups', readdirSync(join(dir, 'backups'))[0] ?? '')

    // How a user puts a backup back: a fresh folder, with the backup as ledger.sqlite.
    const restored = join(root, 'restored')
    mkdirSync(restored)
    copyFileSync(backup, join(restored, 'ledger.sqlite'))
    const reopened = open({ dir: restored, migrations: upToLater })

    expect(reopened.db.prepare('SELECT x FROM item').pluck().all()).toEqual([1])
    expect(tables(reopened.db)).toEqual(['__migrations', 'item', 'later', 'meta'])
  })

  test('the backup has commits still in the WAL, which a file copy would miss', () => {
    const dir = join(root, 'ledger')
    const file = join(dir, 'ledger.sqlite')
    // Left open, so its commit stays in ledger.sqlite-wal and never reaches ledger.sqlite.
    const writer = open({ dir, migrations: upToFirst })
    writer.db.prepare('INSERT INTO item VALUES (1)').run()

    const fileCopy = join(root, 'file-copy.sqlite')
    copyFileSync(file, fileCopy)
    // Not even the table: the migration's commit is in the WAL too.
    expect(inCopy(fileCopy, tables)).toEqual([])

    open({ dir, migrations: upToLater })
    const backup = join(dir, 'backups', readdirSync(join(dir, 'backups'))[0] ?? '')
    expect(inCopy(backup, (copy) => copy.prepare('SELECT x FROM item').pluck().all())).toEqual([1])
  })
})

describe('meta row', () => {
  test('new ledger records the install, with zero clock and new ids', () => {
    const ledger = open({ dir: join(root, 'ledger') })
    const rows = drizzle(ledger.db).select().from(meta).all()
    expect(rows).toEqual([
      {
        id: 1,
        ledgerId: expect.stringMatching(/^[0-9a-f]{32}$/),
        deviceId: expect.stringMatching(/^[0-9a-f]{16}$/),
        installId: INSTALL,
        clockWallMs: 0,
        clockCounter: 0,
        createdAt: NOW,
      },
    ])
  })

  test('reopening the ledger does not recreate the meta row', () => {
    const ledger = open({ dir: join(root, 'ledger') })
    const rows = drizzle(ledger.db).select().from(meta).all()
    expect(rows).toEqual([
      {
        id: 1,
        ledgerId: expect.stringMatching(/^[0-9a-f]{32}$/),
        deviceId: expect.stringMatching(/^[0-9a-f]{16}$/),
        installId: INSTALL,
        clockWallMs: 0,
        clockCounter: 0,
        createdAt: NOW,
      },
    ])
    const reopenedLedger = open({ dir: join(root, 'ledger') })
    const reopenedMetaRows = drizzle(reopenedLedger.db).select().from(meta).all()
    expect(reopenedMetaRows).toEqual(rows)
  })
})
