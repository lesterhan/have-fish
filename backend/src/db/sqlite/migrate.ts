// Brings a SQLite database file up to the current schema. Used by the local launcher on every
// start (`local/launch.ts`) and by the SQLite test run (`test-preload.ts`), each with a client
// of its own that is closed afterwards, so the app's client first opens a migrated file.

import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

export const SQLITE_MIGRATIONS = join(import.meta.dir, '../../../drizzle/sqlite')

export async function migrateSqliteFile(path: string): Promise<void> {
  const client = createClient({ url: `file:${path}` })
  try {
    await migrate(drizzle(client), { migrationsFolder: SQLITE_MIGRATIONS })
  } finally {
    client.close()
  }
}
