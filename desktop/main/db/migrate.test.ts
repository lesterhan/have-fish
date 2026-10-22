import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { failure } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type Migration, migrate } from './migrate'

const NOW = Date.UTC(2026, 9, 22, 12)

const first: Migration = {
  tag: '0000_first',
  statements: ['CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'],
}
const second: Migration = {
  tag: '0001_second',
  statements: ['ALTER TABLE item ADD note TEXT', 'CREATE INDEX item_name ON item (name)'],
}

let db: Database.Database
let root: string
let backups: string
beforeEach(() => {
  db = new Database(':memory:')
  root = mkdtempSync(join(tmpdir(), 'havefish-migrate-'))
  backups = join(root, 'backups')
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

const applied = (tags: string[]) => ({ ok: true, value: tags })
const tags = () => db.prepare('SELECT tag FROM __migrations ORDER BY tag').pluck().all()
const tableExists = (name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined

test('a new file gets every migration, recorded by tag', () => {
  expect(migrate(db, [first, second], NOW, backups)).toEqual(applied(['0000_first', '0001_second']))
  expect(tags()).toEqual(['0000_first', '0001_second'])
  expect(db.prepare('SELECT appliedAt FROM __migrations').pluck().all()).toEqual([NOW, NOW])
  expect(db.prepare('SELECT id, name, note FROM item').all()).toEqual([])
})

test('a second run applies nothing', () => {
  migrate(db, [first, second], NOW, backups)
  expect(migrate(db, [first, second], NOW, backups)).toEqual(applied([]))
  expect(tags()).toEqual(['0000_first', '0001_second'])
})

test('a later build applies only the migration that is new to the file', () => {
  migrate(db, [first], NOW, backups)
  db.prepare("INSERT INTO item (name) VALUES ('kept')").run()

  expect(migrate(db, [first, second], NOW, backups)).toEqual(applied(['0001_second']))
  expect(db.prepare('SELECT name, note FROM item').all()).toEqual([{ name: 'kept', note: null }])
})

test('a migration that fails part-way leaves the file at the one before', () => {
  migrate(db, [first], NOW, backups)
  const broken: Migration = {
    tag: '0001_broken',
    statements: ['CREATE TABLE made (x)', 'ALTER TABLE missing ADD y TEXT'],
  }

  expect(() => migrate(db, [first, broken], NOW, backups)).toThrow(/no such table: missing/)
  expect(tags()).toEqual(['0000_first'])
  expect(tableExists('made')).toBe(false)
})

test('a file a newer build migrated is refused, and nothing is written', () => {
  const later: Migration = { tag: '0002_later', statements: ['CREATE TABLE later (x)'] }
  migrate(db, [first, later], NOW, backups)
  const schema = () => db.prepare('SELECT sql FROM sqlite_master ORDER BY name').pluck().all()
  const before = schema()

  // This build knows `second` but not `later`: it must not apply `second` either.
  expect(migrate(db, [first, second], NOW, backups)).toEqual(
    failure('LEDGER_TOO_NEW', { path: ':memory:', unknown: ['0002_later'] }),
  )
  expect(tags()).toEqual(['0000_first', '0002_later'])
  expect(schema()).toEqual(before)
})

describe('foreign keys', () => {
  const parentAndChild: Migration = {
    tag: '0000_parent_and_child',
    statements: [
      'CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
      'CREATE TABLE child (id INTEGER PRIMARY KEY, parentId INTEGER NOT NULL REFERENCES parent (id))',
    ],
  }
  const foreignKeysOn = () => db.pragma('foreign_keys', { simple: true })

  beforeEach(() => {
    db.pragma('foreign_keys = ON')
    migrate(db, [parentAndChild], NOW, backups)
    db.exec(
      "INSERT INTO parent VALUES (1, 'a'), (2, 'b'); INSERT INTO child VALUES (10, 1), (20, 2)",
    )
  })

  test('a table rebuild keeps every row, and foreign keys are back on after', () => {
    // How drizzle-kit changes a column: copy into a new table, drop the old one, rename.
    const rebuildParent: Migration = {
      tag: '0001_rebuild_parent',
      statements: [
        'PRAGMA foreign_keys=OFF',
        'CREATE TABLE __new_parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT)',
        'INSERT INTO __new_parent (id, name) SELECT id, name FROM parent',
        'DROP TABLE parent',
        'ALTER TABLE __new_parent RENAME TO parent',
        'PRAGMA foreign_keys=ON',
      ],
    }

    expect(migrate(db, [parentAndChild, rebuildParent], NOW, backups)).toEqual(
      applied(['0001_rebuild_parent']),
    )
    expect(db.prepare('SELECT id, name, note FROM parent').all()).toEqual([
      { id: 1, name: 'a', note: null },
      { id: 2, name: 'b', note: null },
    ])
    expect(db.prepare('SELECT id, parentId FROM child').all()).toEqual([
      { id: 10, parentId: 1 },
      { id: 20, parentId: 2 },
    ])
    expect(foreignKeysOn()).toBe(1)
  })

  test('a migration that leaves a row pointing at nothing is rolled back', () => {
    const orphan: Migration = {
      tag: '0001_orphan',
      statements: ['INSERT INTO child VALUES (30, 999)'],
    }

    expect(() => migrate(db, [parentAndChild, orphan], NOW, backups)).toThrow(
      '0001_orphan left rows in child pointing at nothing',
    )
    expect(tags()).toEqual(['0000_parent_and_child'])
    expect(db.prepare('SELECT id FROM child').pluck().all()).toEqual([10, 20])
    expect(foreignKeysOn()).toBe(1)
  })
})

describe('the backup', () => {
  const copies = () => (existsSync(backups) ? readdirSync(backups) : [])

  test('a file with data is copied before a new migration, as it was', () => {
    migrate(db, [first], NOW, backups)
    db.prepare("INSERT INTO item (name) VALUES ('kept')").run()

    migrate(db, [first, second], NOW, backups)

    expect(copies()).toEqual(['ledger-2026-10-22T12-00-00-000Z-before-0001_second.sqlite'])
    const copy = new Database(join(backups, copies()[0] ?? ''), { readonly: true })
    try {
      expect(copy.prepare('SELECT name FROM item').pluck().all()).toEqual(['kept'])
      expect(copy.prepare('SELECT tag FROM __migrations').pluck().all()).toEqual(['0000_first'])
      expect(copy.prepare('SELECT name FROM pragma_table_info(?)').pluck().all('item')).toEqual([
        'id',
        'name',
      ])
    } finally {
      copy.close()
    }
  })

  test('a new file is not copied: it has nothing to lose', () => {
    migrate(db, [first, second], NOW, backups)
    expect(copies()).toEqual([])
  })

  test('a file with nothing pending is not copied', () => {
    migrate(db, [first], NOW, backups)
    migrate(db, [first], NOW, backups)
    expect(copies()).toEqual([])
  })

  test('the copy comes before the migration, so a failed one still leaves it', () => {
    migrate(db, [first], NOW, backups)
    const broken: Migration = { tag: '0001_broken', statements: ['ALTER TABLE missing ADD y'] }

    expect(() => migrate(db, [first, broken], NOW, backups)).toThrow(/no such table/)
    expect(copies()).toEqual(['ledger-2026-10-22T12-00-00-000Z-before-0001_broken.sqlite'])
  })

  test('if the backup fails, nothing migrates', () => {
    migrate(db, [first], NOW, backups)
    writeFileSync(backups, 'a file where the folder should be')

    expect(() => migrate(db, [first, second], NOW, backups)).toThrow()
    expect(tags()).toEqual(['0000_first'])
    expect(db.prepare('SELECT name FROM pragma_table_info(?)').pluck().all('item')).toEqual([
      'id',
      'name',
    ])
  })

  test('a file from a newer build is not copied', () => {
    const later: Migration = { tag: '0002_later', statements: ['CREATE TABLE later (x)'] }
    migrate(db, [first, later], NOW, backups)
    migrate(db, [first], NOW, backups)
    expect(copies()).toEqual([])
  })
})
