// Wipes all application data from the dev database.
// Usage: bun run scripts/reset-db.ts
// Use this to reset to a clean state for QA. Does NOT drop tables or touch migrations.

import { db } from '../src/db'
import { user, accounts, transactions, postings, csvParsers, userSettings } from '../src/db/schema'

console.log('Resetting database...')

await db.delete(postings)
await db.delete(transactions)
await db.delete(userSettings)
await db.delete(csvParsers)
await db.delete(accounts)
await db.delete(user)

console.log('Done. All users and data have been deleted.')

process.exit(0)
