import { db } from './db'
import { accounts } from './db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type Tx = PgTransaction<PostgresJsQueryResultHKT, typeof import('./db/schema'), ExtractTablesWithRelations<typeof import('./db/schema')>>

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Find or create the group:<group-slug> account for a user in a group.
// Used as the balancing credit leg for all group expense auto-postings.
export async function ensureSharedAccount(
  userId: string,
  group: { id: string; name: string },
  tx?: Tx,
): Promise<string> {
  const path = `group:${slugify(group.name)}`
  const client = tx ?? db

  const [existing] = await client
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.path, path), isNull(accounts.deletedAt)))

  if (existing) return existing.id

  const [created] = await client
    .insert(accounts)
    .values({ userId, path, name: `Group: ${group.name}` })
    .returning({ id: accounts.id })

  return created.id
}

// Find or create an uncategorized account for a user.
// Used when a member has no defaultExpenseAccountId configured.
export async function ensureUncategorizedAccount(
  userId: string,
  tx?: Tx,
): Promise<string> {
  const path = 'uncategorized'
  const client = tx ?? db

  const [existing] = await client
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.path, path), isNull(accounts.deletedAt)))

  if (existing) return existing.id

  const [created] = await client
    .insert(accounts)
    .values({ userId, path, name: 'Uncategorized' })
    .returning({ id: accounts.id })

  return created.id
}
