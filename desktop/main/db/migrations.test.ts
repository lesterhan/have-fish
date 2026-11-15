import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import Database from 'better-sqlite3'
import { describe, expect, onTestFinished, test } from 'vitest'
import { ok } from '../ledger/fixtures'
import { accountRows, transactionRows } from '../ledger/rows'
import { getDocument } from '../ledger/store'
import { openLedger } from './ledger'
import type { Migration } from './migrate'
import { MIGRATIONS } from './migrations'

const MADE = Date.UTC(2026, 9, 1, 12)
const OPENED_A = Date.UTC(2026, 10, 15, 12)
const OPENED_B = Date.UTC(2026, 11, 24, 8)
const VERSION = { wallMs: MADE, counter: 0, deviceId: '0123456789abcdef' }
const MANUAL = { source: 'manual', createdAt: MADE, deviceId: 'feedfacecafebeef' } as const
const CASH = '00000000-0000-4000-8000-0000000000a1'
const FOOD = '00000000-0000-4000-8000-0000000000a2'
const SPEND_ID = '00000000-0000-4000-8000-000000000001'

const ACCOUNT: Versioned<AccountDoc> = {
  doc: {
    type: 'account',
    id: CASH,
    path: 'assets:cash',
    kind: 'cash',
    currency: 'CAD',
    deletedAt: null,
    origin: MANUAL,
  },
  version: VERSION,
}

const SPEND: Versioned<TransactionDoc> = {
  doc: {
    type: 'transaction',
    id: SPEND_ID,
    date: '2026-10-01',
    description: 'Groceries',
    postings: [
      { accountId: CASH, amount: '-12.50', currency: 'CAD' },
      { accountId: FOOD, amount: '12.50', currency: 'CAD' },
    ],
    deletedAt: null,
    origin: MANUAL,
  },
  version: VERSION,
}

// In this order, so a posting's transaction is in before it.
const ROWS: [string, Record<string, unknown>[]][] = [
  ['accounts', [accountRows(ACCOUNT).account]],
  ['transactions', [transactionRows(SPEND).transaction]],
  ['postings', transactionRows(SPEND).postings],
]

/** Each table's rows as the file held them before today's build opened it. */
type Held = Record<string, Record<string, unknown>[]>

// better-sqlite3 types a pragma's rows as unknown.
const columnsOf = (db: Database.Database, table: string) =>
  (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)

const rowsIn = (db: Database.Database, table: string) =>
  db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]

/** A file stopped at `tag` holding today's rows, copied to `a/` and `b/` under `root`. */
function fileStoppedAt(
  tag: string,
  migrations: readonly Migration[],
): { root: string; held: Held } {
  const root = mkdtempSync(join(tmpdir(), 'havefish-upgrade-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const through = migrations.slice(0, migrations.findIndex((m) => m.tag === tag) + 1)
  const old = ok(
    openLedger({
      dir: join(root, 'old'),
      installId: 'install-old',
      migrations: through,
      now: MADE,
    }),
  )
  try {
    const held: Held = {}
    for (const [table, rows] of ROWS) {
      const columns = columnsOf(old.db, table)
      expect(columns).not.toEqual([])
      for (const row of rows) {
        const kept = Object.keys(row).filter((key) => columns.includes(key))
        old.db
          .prepare(
            `INSERT INTO ${table} (${kept.map((k) => `\`${k}\``).join(', ')})
              VALUES (${kept.map((k) => `@${k}`).join(', ')})`,
          )
          .run(Object.fromEntries(kept.map((k) => [k, row[k]])))
      }
      held[table] = rowsIn(old.db, table)
    }
    for (const copy of ['a', 'b']) {
      mkdirSync(join(root, copy), { mode: 0o700 })
      old.db.prepare('VACUUM INTO ?').run(join(root, copy, 'ledger.sqlite'))
    }
    return { root, held }
  } finally {
    old.close()
  }
}

/** True where the file held every column today's rows of `tables` have. */
function heldWhole(held: Held, ...tables: string[]): boolean {
  return ROWS.filter(([table]) => tables.includes(table)).every(([table, rows]) =>
    rows.every((row, i) => Object.keys(row).every((key) => key in (held[table]?.[i] ?? {}))),
  )
}

/** Opens a file stopped at `tag` with `migrations`, and checks each document comes through. */
function opensWhole(tag: string, migrations: readonly Migration[]): void {
  const { root, held } = fileStoppedAt(tag, migrations)
  const ledger = ok(
    openLedger({ dir: join(root, 'a'), installId: 'install-a', migrations, now: OPENED_A }),
  )
  try {
    const account = getDocument(ledger.db, 'account', CASH)
    const spend = getDocument(ledger.db, 'transaction', SPEND_ID)
    expect(account?.doc.id).toBe(CASH)
    expect(spend?.doc.id).toBe(SPEND_ID)

    for (const [table] of ROWS) expect(rowsIn(ledger.db, table)).toMatchObject(held[table] ?? [])

    if (heldWhole(held, 'accounts')) expect(account).toEqual(ACCOUNT)
    if (heldWhole(held, 'transactions', 'postings')) expect(spend).toEqual(SPEND)
  } finally {
    ledger.close()
  }
}

const TAGS = MIGRATIONS.slice(1).map((m) => m.tag)

describe('a file stopped at each migration', () => {
  test.each(TAGS)(
    'stopped at %s, opens with every document read back and every value it held kept',
    (tag) => {
      opensWhole(tag, MIGRATIONS)
    },
  )
})

/** The device id the file at `dir` holds, read without opening it as a ledger. */
function deviceIdIn(dir: string): string {
  const db = new Database(join(dir, 'ledger.sqlite'))
  try {
    return db.prepare('SELECT deviceId FROM meta').pluck().get() as string
  } finally {
    db.close()
  }
}

describe('two copies of a file stopped at each migration', () => {
  test.each(TAGS)(
    'stopped at %s, hold the same documents once two installs upgrade them at two times',
    (tag) => {
      const { root } = fileStoppedAt(tag, MIGRATIONS)
      const through = MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.tag === tag) + 1)
      const oldDeviceId = deviceIdIn(join(root, 'a'))
      const before = ok(
        openLedger({
          dir: join(root, 'b'),
          installId: 'install-b',
          migrations: through,
          now: MADE + 1,
        }),
      )
      try {
        expect(before.meta.deviceId).not.toBe(oldDeviceId)
      } finally {
        before.close()
      }

      const a = ok(openLedger({ dir: join(root, 'a'), installId: 'install-a', now: OPENED_A }))
      try {
        const b = ok(openLedger({ dir: join(root, 'b'), installId: 'install-b', now: OPENED_B }))
        try {
          const documentsIn = (db: Database.Database) => [
            getDocument(db, 'account', CASH),
            getDocument(db, 'transaction', SPEND_ID),
          ]
          const onA = documentsIn(a.db)
          expect(onA[0]).not.toBeNull()
          expect(documentsIn(b.db)).toEqual(onA)
        } finally {
          b.close()
        }
      } finally {
        a.close()
      }
    },
  )
})
