import { beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { clearDatabase, createTestUser, request } from '../../test-utils'
import { db, dialect } from '../index'

// Migration 0043 turns transactions.date from a timestamp into YYYY-MM-DD text (#277). The
// test database is already past it, so this puts the column back to a timestamp inside a
// transaction, seeds the shapes the old code stored, runs the migration's own SQL, checks
// the result and rolls everything back.
const migrationSql = readFileSync(
  join(import.meta.dir, '../../../drizzle/0043_transactions_date_text.sql'),
  'utf8',
)

class Rollback extends Error {}

// Postgres DDL, so the SQLite run (`test:sqlite`) skips it.
describe.skipIf(dialect !== 'pg')('migration 0043: transactions.date to calendar-date text', () => {
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    const cookie = await createTestUser()
    const session = await request('/api/auth/get-session', { headers: { Cookie: cookie } })
    userId = ((await session.json()) as { user: { id: string } }).user.id
  })

  it('keeps the day every row showed, and leaves a text column', async () => {
    let dates: string[] = []
    let type = ''
    await db
      .transaction(async (tx) => {
        await tx.execute(
          sql`ALTER TABLE transactions ALTER COLUMN date SET DATA TYPE timestamp USING date::timestamp`,
        )
        // UTC midnight (every create path), a late-UTC time (a non-ISO import on a machine
        // east of UTC stored the previous day's afternoon), and the last instant of a year.
        await tx.execute(sql`
          INSERT INTO transactions (user_id, date, description) VALUES
            (${userId}, '2026-09-12 00:00:00', 'midnight'),
            (${userId}, '2026-09-11 15:00:00', 'afternoon'),
            (${userId}, '2026-12-31 23:59:59.999', 'year end')`)
        await tx.execute(sql.raw(migrationSql))
        const rows = await tx.execute<{ description: string; date: string }>(
          sql`SELECT description, date FROM transactions ORDER BY description`,
        )
        dates = rows.map((r) => `${r.description}: ${r.date}`)
        const [column] = await tx.execute<{ data_type: string }>(
          sql`SELECT data_type FROM information_schema.columns
              WHERE table_name = 'transactions' AND column_name = 'date'`,
        )
        type = column?.data_type ?? ''
        throw new Rollback()
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e
      })

    // The app always read the timestamp as its UTC date, so these are the days it showed.
    expect(dates).toEqual(['afternoon: 2026-09-11', 'midnight: 2026-09-12', 'year end: 2026-12-31'])
    expect(type).toBe('text')
  })
})
