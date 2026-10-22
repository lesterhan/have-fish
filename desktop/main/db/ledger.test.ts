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
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type Ledger, type OpenOptions, openLedger } from './ledger'
import type { Migration } from './migrate'

const NOW = Date.UTC(2026, 9, 22, 12)

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

/** Opens a ledger that is closed after the test. A refusal fails the test. */
function open(options: Omit<OpenOptions, 'now'>): Ledger {
  const result = openLedger({ now: NOW, ...options })
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

test('refuses a file that is not SQLite, and leaves it as it was', () => {
  const dir = join(root, 'ledger')
  const file = join(dir, 'ledger.sqlite')
  mkdirSync(dir)
  const garbage = randomBytes(4096)
  writeFileSync(file, garbage)

  expect(openLedger({ dir, now: NOW })).toEqual(failure('LEDGER_UNREADABLE', { path: file }))
  expect(readFileSync(file).equals(garbage)).toBe(true)
})

describe('migrations', () => {
  const first: Migration = { tag: '0000_first', statements: ['CREATE TABLE item (x)'] }
  const later: Migration = { tag: '0001_later', statements: ['CREATE TABLE later (x)'] }

  test('opening applies the migrations it is given', () => {
    const ledger = open({ dir: join(root, 'ledger'), migrations: [first] })
    expect(ledger.db.prepare('SELECT tag FROM __migrations').pluck().all()).toEqual(['0000_first'])
  })

  test('a file a newer build migrated is refused, and its bytes are unchanged', () => {
    const dir = join(root, 'ledger')
    const file = join(dir, 'ledger.sqlite')
    open({ dir, migrations: [first, later] }).close()
    const before = readFileSync(file)

    expect(openLedger({ dir, migrations: [first], now: NOW })).toEqual(
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
    const ledger = open({ dir, migrations: [first] })
    ledger.db.prepare('INSERT INTO item VALUES (1)').run()
    ledger.close()

    const live = open({ dir, migrations: [first, later] })

    const backups = join(dir, 'backups')
    expect(statSync(backups).mode & 0o777).toBe(0o700)
    expect(readdirSync(backups)).toEqual([
      'ledger-2026-10-22T12-00-00-000Z-before-0001_later.sqlite',
    ])
    const backup = join(backups, readdirSync(backups)[0] ?? '')
    expect(inCopy(backup, tables)).toEqual(['__migrations', 'item'])
    expect(inCopy(backup, (copy) => copy.prepare('SELECT x FROM item').pluck().all())).toEqual([1])
    expect(tables(live.db)).toEqual(['__migrations', 'item', 'later'])
  })

  test('the backup has commits still in the WAL, which a file copy would miss', () => {
    const dir = join(root, 'ledger')
    const file = join(dir, 'ledger.sqlite')
    // Left open, so its commit stays in ledger.sqlite-wal and never reaches ledger.sqlite.
    const writer = open({ dir, migrations: [first] })
    writer.db.prepare('INSERT INTO item VALUES (1)').run()

    const fileCopy = join(root, 'file-copy.sqlite')
    copyFileSync(file, fileCopy)
    // Not even the table: the migration's commit is in the WAL too.
    expect(inCopy(fileCopy, tables)).toEqual([])

    open({ dir, migrations: [first, later] })
    const backup = join(dir, 'backups', readdirSync(join(dir, 'backups'))[0] ?? '')
    expect(inCopy(backup, (copy) => copy.prepare('SELECT x FROM item').pluck().all())).toEqual([1])
  })
})
