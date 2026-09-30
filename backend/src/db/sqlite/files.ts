// Operations on a SQLite ledger file as a file, outside the app's own client: copying one,
// and asking it questions before anything opens it for real. `local/adopt-service.ts` uses them
// to check a ledger before it replaces another (#289), and `local/hosted-export-service.ts`
// uses them to check the one it just wrote. Like `migrate.ts`, each opens a client of its own
// and closes it afterwards.

import { createClient } from '@libsql/client'

async function withFile<T>(
  path: string,
  work: (client: ReturnType<typeof createClient>) => Promise<T>,
) {
  const client = createClient({ url: `file:${path}` })
  try {
    return await work(client)
  } finally {
    client.close()
  }
}

/**
 * Copies the database at `path` to `dest`, which must not exist. Through SQLite rather than of
 * the bytes: it carries what is still in the WAL, and it fails on a file that is not a database.
 */
export function copyDatabase(path: string, dest: string): Promise<void> {
  return withFile(path, async (client) => {
    await client.execute({ sql: 'VACUUM INTO ?', args: [dest] })
  })
}

export function hasTable(path: string, name: string): Promise<boolean> {
  return withFile(path, async (client) => {
    const found = await client.execute({
      sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      args: [name],
    })
    return found.rows.length > 0
  })
}

/** How many transactions the file records, deleted ones included; 0 when it has no table. */
export async function transactionCount(path: string): Promise<number> {
  if (!(await hasTable(path, 'transactions'))) return 0
  return withFile(path, async (client) => {
    const found = await client.execute('SELECT count(*) AS n FROM transactions')
    return Number(found.rows[0]?.n ?? 0)
  })
}

/** How many local profiles the file has whose user is there too. A ledger has exactly one. */
export async function ownerCount(path: string): Promise<number> {
  if (!(await hasTable(path, 'local_profile'))) return 0
  return withFile(path, async (client) => {
    const found = await client.execute(
      'SELECT count(*) AS n FROM local_profile JOIN user ON user.id = local_profile.user_id',
    )
    return Number(found.rows[0]?.n ?? 0)
  })
}

/** How many rows point at a row that is not there, whether or not foreign keys were on. */
export function danglingReferences(path: string): Promise<number> {
  return withFile(path, async (client) => {
    const found = await client.execute('PRAGMA foreign_key_check')
    return found.rows.length
  })
}
