import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Use a separate database for tests so the dev database is never touched by the test suite.
// Set NODE_ENV=test (done automatically by the test scripts in package.json).
const url =
  process.env.NODE_ENV === 'test' ? process.env.TEST_DATABASE_URL! : process.env.DATABASE_URL!

const client = postgres(url)

export const db = drizzle(client, { schema })

/** An open database transaction, as `db.transaction(async (tx) => …)` hands it over. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Whatever a query can run on: the client itself, or a transaction someone else opened.
 * A function that writes as part of a larger unit of work takes one of these rather than
 * opening its own, so the caller decides where the unit begins and ends.
 */
export type Executor = typeof db | DbTransaction
