// The Postgres client: the server build's half of `#dialect` (see `db/index.ts`).

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Typed as either, so shared code can ask which one it is running on.
export const dialect: 'pg' | 'sqlite' = 'pg'

// Use a separate database for tests so the dev database is never touched by the test suite.
// Set NODE_ENV=test (done automatically by the test scripts in package.json).
const url =
  process.env.NODE_ENV === 'test' ? process.env.TEST_DATABASE_URL! : process.env.DATABASE_URL!

const client = postgres(url)
export const db = drizzle(client, { schema })

/** Lets queries in flight finish, then closes the pool. */
export async function closeDatabase(): Promise<void> {
  await client.end({ timeout: 5 })
}

/**
 * Locks the rows a read inside a transaction returns until it commits, so a read-modify-write
 * cannot interleave with another. SQLite's half returns the query untouched: its transactions
 * already hold the database's one write lock.
 */
export function forUpdate<Locked>(query: { for(strength: 'update'): Locked }): Locked {
  return query.for('update')
}
