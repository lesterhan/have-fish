import { beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { clearDatabase, createTestUser, request } from '../../test-utils'
import { db, dialect } from '../index'

// Migration 0044 adds accounts.path_key and the unique index over it (#480). The test database
// is already past it, so this takes both off again inside a transaction, seeds rows the old
// schema allowed, runs the migration's own SQL, checks the result and rolls everything back.
const migrationSql = readFileSync(
  join(import.meta.dir, '../../../drizzle/0044_accounts_path_key.sql'),
  'utf8',
)

class Rollback extends Error {}

/** Runs `body` against the pre-0044 schema, then rolls it all back. */
async function beforeMigration(
  body: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
) {
  await db
    .transaction(async (tx) => {
      await tx.execute(sql`DROP INDEX accounts_user_path_key_idx`)
      await tx.execute(sql`ALTER TABLE accounts DROP COLUMN path_key`)
      await body(tx)
      throw new Rollback()
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e
    })
}

// Postgres DDL, so the SQLite run (`test:sqlite`) skips it.
describe.skipIf(dialect !== 'pg')('migration 0044: accounts.path_key', () => {
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    const cookie = await createTestUser()
    const session = await request('/api/auth/get-session', { headers: { Cookie: cookie } })
    userId = ((await session.json()) as { user: { id: string } }).user.id
  })

  it('backfills every row with its lowercase path, deleted rows included', async () => {
    let rows: string[] = []
    let nullable = ''
    await beforeMigration(async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (user_id, path, deleted_at) VALUES
          (${userId}, 'Assets:Wise', NULL),
          (${userId}, '储蓄:中国银行', NULL),
          (${userId}, 'assets:wise', now())`)
      await tx.execute(sql.raw(migrationSql))
      const out = await tx.execute<{ path: string; path_key: string }>(
        sql`SELECT path, path_key FROM accounts
            WHERE path IN ('Assets:Wise', '储蓄:中国银行', 'assets:wise') ORDER BY path`,
      )
      rows = out.map((r) => `${r.path} -> ${r.path_key}`)
      const [column] = await tx.execute<{ is_nullable: string }>(
        sql`SELECT is_nullable FROM information_schema.columns
            WHERE table_name = 'accounts' AND column_name = 'path_key'`,
      )
      nullable = column?.is_nullable ?? ''
    })

    // An active path and a deleted one may share a key: the index only covers active rows.
    expect(rows.sort()).toEqual([
      'Assets:Wise -> assets:wise',
      'assets:wise -> assets:wise',
      '储蓄:中国银行 -> 储蓄:中国银行',
    ])
    expect(nullable).toBe('NO')
  })

  it('fails, changing nothing, when a user has two active paths equal ignoring case', async () => {
    let failure = ''
    await beforeMigration(async (tx) => {
      await tx.execute(sql`
        INSERT INTO accounts (user_id, path) VALUES (${userId}, 'assets:wise'), (${userId}, 'Assets:Wise')`)
      await tx.execute(sql.raw(migrationSql)).catch((e: Error) => {
        failure = `${e.message} ${(e.cause as Error | undefined)?.message ?? ''}`
      })
    })

    expect(failure).toContain('accounts_user_path_key_idx')
  })
})
