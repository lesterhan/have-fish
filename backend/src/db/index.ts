import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Use a separate database for tests so the dev database is never touched by the test suite.
// Set NODE_ENV=test (done automatically by the test scripts in package.json).
const url = process.env.NODE_ENV === 'test'
  ? process.env.TEST_DATABASE_URL!
  : process.env.DATABASE_URL!

const client = postgres(url)

export const db = drizzle(client, { schema })
