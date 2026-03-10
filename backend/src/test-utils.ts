import { db } from './db'
import { accounts, categories, transactions } from './db/schema'

// Wipe all rows in dependency order (transactions → accounts → categories)
export async function clearDatabase() {
  await db.delete(transactions)
  await db.delete(accounts)
  await db.delete(categories)
}
