import { failure } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, test } from 'vitest'
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
beforeEach(() => {
  db = new Database(':memory:')
})
afterEach(() => {
  db.close()
})

const applied = (tags: string[]) => ({ ok: true, value: tags })
const tags = () => db.prepare('SELECT tag FROM __migrations ORDER BY tag').pluck().all()
const tableExists = (name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined

test('a new file gets every migration, recorded by tag', () => {
  expect(migrate(db, [first, second], NOW)).toEqual(applied(['0000_first', '0001_second']))
  expect(tags()).toEqual(['0000_first', '0001_second'])
  expect(db.prepare('SELECT appliedAt FROM __migrations').pluck().all()).toEqual([NOW, NOW])
  expect(db.prepare('SELECT id, name, note FROM item').all()).toEqual([])
})

test('a second run applies nothing', () => {
  migrate(db, [first, second], NOW)
  expect(migrate(db, [first, second], NOW)).toEqual(applied([]))
  expect(tags()).toEqual(['0000_first', '0001_second'])
})

test('a later build applies only the migration that is new to the file', () => {
  migrate(db, [first], NOW)
  db.prepare("INSERT INTO item (name) VALUES ('kept')").run()

  expect(migrate(db, [first, second], NOW)).toEqual(applied(['0001_second']))
  expect(db.prepare('SELECT name, note FROM item').all()).toEqual([{ name: 'kept', note: null }])
})

test('a migration that fails part-way leaves the file at the one before', () => {
  migrate(db, [first], NOW)
  const broken: Migration = {
    tag: '0001_broken',
    statements: ['CREATE TABLE made (x)', 'ALTER TABLE missing ADD y TEXT'],
  }

  expect(() => migrate(db, [first, broken], NOW)).toThrow(/no such table: missing/)
  expect(tags()).toEqual(['0000_first'])
  expect(tableExists('made')).toBe(false)
})

test('a file a newer build migrated is refused, and nothing is written', () => {
  const later: Migration = { tag: '0002_later', statements: ['CREATE TABLE later (x)'] }
  migrate(db, [first, later], NOW)
  const schema = () => db.prepare('SELECT sql FROM sqlite_master ORDER BY name').pluck().all()
  const before = schema()

  // This build knows `second` but not `later`: it must not apply `second` either.
  expect(migrate(db, [first, second], NOW)).toEqual(
    failure('LEDGER_TOO_NEW', { path: ':memory:', unknown: ['0002_later'] }),
  )
  expect(tags()).toEqual(['0000_first', '0002_later'])
  expect(schema()).toEqual(before)
})
