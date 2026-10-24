import { defineConfig } from 'drizzle-kit'

// Generates SQL only. drizzle-kit never touches a ledger: `openLedger` applies the migrations.
export default defineConfig({
  dialect: 'sqlite',
  schema: './main/db/schema.ts',
  out: './drizzle',
})
