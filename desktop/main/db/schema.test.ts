import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
