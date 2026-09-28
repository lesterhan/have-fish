import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/pg/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.TEST_DATABASE_URL!,
  },
} satisfies Config
