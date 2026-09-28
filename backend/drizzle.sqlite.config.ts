import type { Config } from 'drizzle-kit'

// The local build's schema (D8, #286). Its migrations live beside the Postgres ones, in their
// own folder and with their own journal, because the two dialects' DDL has nothing in common.
export default {
  schema: './src/db/sqlite/schema.ts',
  out: './drizzle/sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: `file:${process.env.SQLITE_PATH ?? 'havefish.sqlite'}`,
  },
} satisfies Config
