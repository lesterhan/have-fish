import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, onTestFinished, test } from 'vitest'
import { migrate } from './migrate'
import { MIGRATIONS } from './migrations'
import { meta } from './schema'

const NOW = Date.UTC(2026, 9, 22, 12)

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  // A new file is never backed up, so the folder is never made.
  migrate(db, MIGRATIONS, NOW, join(tmpdir(), 'havefish-never-written'))
})
afterEach(() => db.close())

describe('meta', () => {
  const row = {
    ledgerId: '0123456789abcdef0123456789abcdef',
    deviceId: '0123456789abcdef',
    installId: 'install-1',
    clockWallMs: 0,
    clockCounter: 0,
    createdAt: NOW,
  }

  test('takes a row, which gets id 1', () => {
    const orm = drizzle(db)
    orm.insert(meta).values(row).run()
    expect(orm.select().from(meta).all()).toEqual([{ id: 1, ...row }])
  })

  test('refuses a second row', () => {
    const orm = drizzle(db)
    orm.insert(meta).values(row).run()
    expect(() => orm.insert(meta).values(row).run()).toThrow('meta_one_row')
  })

  describe.each([
    ['ledgerId', 32, 'meta_ledger_id'],
    ['deviceId', 16, 'meta_device_id'],
  ] as const)('%s', (column, length, check) => {
    test.each([
      ['short', 'a'.repeat(length - 1)],
      ['long', 'a'.repeat(length + 1)],
      ['uppercase', 'A'.repeat(length)],
      ['not hex', `${'a'.repeat(length - 1)}g`],
    ])('refuses one that is %s', (_why, value) => {
      const insert = () =>
        drizzle(db)
          .insert(meta)
          .values({ ...row, [column]: value })
          .run()
      expect(insert).toThrow(check)
    })
  })
})

describe('the ledger tables', () => {
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string; type: string; notnull: number }[]).map(
      ({ name, type, notnull }) => `${name} ${type}${notnull ? ' not null' : ''}`,
    )
  const indexes = (table: string) =>
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
      )
      .pluck()
      .all(table)
  const foreignKeys = (table: string) =>
    (
      db.pragma(`foreign_key_list(${table})`) as {
        from: string
        table: string
        on_delete: string
      }[]
    ).map(({ from, table, on_delete }) => `${from} -> ${table} on delete ${on_delete}`)

  test('accounts', () => {
    expect(columns('accounts')).toEqual([
      'id TEXT not null',
      'path TEXT not null',
      'pathKey TEXT not null',
      'kind TEXT not null',
      'deletedAt INTEGER',
      'version TEXT not null',
      'originSource TEXT not null',
      'originCreatedAt INTEGER not null',
      'originDeviceId TEXT not null',
      'originFile TEXT',
      'originLine INTEGER',
      'originText TEXT',
    ])
    expect(indexes('accounts')).toEqual(['accounts_path_key'])
  })

  test('transactions', () => {
    expect(columns('transactions')).toEqual([
      'id TEXT not null',
      'date TEXT not null',
      'description TEXT not null',
      'deletedAt INTEGER',
      'version TEXT not null',
      'originSource TEXT not null',
      'originCreatedAt INTEGER not null',
      'originDeviceId TEXT not null',
      'originFile TEXT',
      'originLine INTEGER',
      'originText TEXT',
    ])
    expect(indexes('transactions')).toEqual(['transactions_date'])
  })

  test('postings, keyed by transaction and position', () => {
    expect(columns('postings')).toEqual([
      'transactionId TEXT not null',
      'position INTEGER not null',
      'accountId TEXT not null',
      'amountCents INTEGER not null',
      'currency TEXT not null',
    ])
    const key = (db.pragma('table_info(postings)') as { name: string; pk: number }[])
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    expect(key).toEqual(['transactionId', 'position'])
    expect(indexes('postings')).toEqual(['postings_account_id'])
  })

  test('only the transaction is a foreign key: an account can arrive after its postings', () => {
    expect(foreignKeys('postings')).toEqual(['transactionId -> transactions on delete CASCADE'])
  })

  const TXN = '00000000-0000-4000-8000-000000000001'
  const ACCOUNT = '00000000-0000-4000-8000-000000000002'
  const insertTransaction = () =>
    db
      .prepare(
        `INSERT INTO transactions (id, date, description, version, originSource, originCreatedAt, originDeviceId) VALUES (?, '2026-10-29', '', 'v', 'manual', 0, '0123456789abcdef')`,
      )
      .run(TXN)
  const insertPosting = (amountCents: unknown) =>
    db
      .prepare(
        `INSERT INTO postings (transactionId, position, accountId, amountCents, currency) VALUES (?, 0, ?, ?, 'CAD')`,
      )
      .run(TXN, ACCOUNT, amountCents)

  test('a posting takes integer cents, and refuses an amount as text', () => {
    insertTransaction()
    expect(() => insertPosting('12.50')).toThrow('postings_amount_cents_integer')
    expect(() => insertPosting(12.5)).toThrow('postings_amount_cents_integer')
    insertPosting(-1250)
    expect(db.prepare('SELECT amountCents FROM postings').pluck().get()).toBe(-1250)
  })

  test('deleting a transaction deletes its postings', () => {
    insertTransaction()
    insertPosting(-1250)
    db.prepare('DELETE FROM transactions WHERE id = ?').run(TXN)
    expect(db.prepare('SELECT count(*) FROM postings').pluck().get()).toBe(0)
  })

  test('two accounts can share a path', () => {
    const insert = db.prepare(
      `INSERT INTO accounts (id, path, pathKey, kind, version, originSource, originCreatedAt, originDeviceId) VALUES (?, 'assets:cash', 'assets:cash', 'cash', 'v', 'manual', 0, '0123456789abcdef')`,
    )
    insert.run(ACCOUNT)
    insert.run(TXN)
    expect(db.prepare('SELECT count(*) FROM accounts').pluck().get()).toBe(2)
  })

  test.each(['accounts', 'transactions'])('%s refuse a row with no origin', (table) => {
    const insert = () =>
      db.prepare(`INSERT INTO ${table} (id, version) VALUES (?, 'v')`).run(ACCOUNT)
    expect(insert).toThrow('NOT NULL constraint failed')
  })
})

describe('0002_origin', () => {
  const TXN = '00000000-0000-4000-8000-000000000001'
  const ACCOUNT = '00000000-0000-4000-8000-000000000002'
  const before = MIGRATIONS.filter((m) => m.tag < '0002_origin')

  test('keeps the rows of a file from before origins, postings included', () => {
    const old = new Database(':memory:')
    onTestFinished(() => {
      old.close()
    })
    migrate(old, before, NOW, join(tmpdir(), 'havefish-never-written'))
    old.exec(`
      INSERT INTO accounts (id, path, pathKey, kind, version)
        VALUES ('${ACCOUNT}', 'assets:cash', 'assets:cash', 'cash', 'v1');
      INSERT INTO transactions (id, date, description, version)
        VALUES ('${TXN}', '2026-10-29', 'Groceries', 'v2');
      INSERT INTO postings (transactionId, position, accountId, amountCents, currency)
        VALUES ('${TXN}', 0, '${ACCOUNT}', -1250, 'CAD');
    `)

    const backups = mkdtempSync(join(tmpdir(), 'havefish-origin-'))
    onTestFinished(() => rmSync(backups, { recursive: true, force: true }))
    expect(migrate(old, MIGRATIONS, NOW, backups)).toEqual({ ok: true, value: ['0002_origin'] })

    const placeholder = {
      originSource: 'manual',
      originCreatedAt: 0,
      originDeviceId: '0000000000000000',
      originFile: null,
      originLine: null,
      originText: null,
    }
    expect(old.prepare('SELECT * FROM accounts').all()).toEqual([
      {
        id: ACCOUNT,
        path: 'assets:cash',
        pathKey: 'assets:cash',
        kind: 'cash',
        deletedAt: null,
        version: 'v1',
        ...placeholder,
      },
    ])
    expect(old.prepare('SELECT * FROM transactions').all()).toEqual([
      {
        id: TXN,
        date: '2026-10-29',
        description: 'Groceries',
        deletedAt: null,
        version: 'v2',
        ...placeholder,
      },
    ])
    expect(old.prepare('SELECT amountCents FROM postings').pluck().all()).toEqual([-1250])

    // The postings still cascade from the rebuilt table.
    old.prepare('DELETE FROM transactions').run()
    expect(old.prepare('SELECT count(*) FROM postings').pluck().get()).toBe(0)
  })
})
