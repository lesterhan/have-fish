import { db } from './db'
import { accounts } from './db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type Tx = PgTransaction<PostgresJsQueryResultHKT, typeof import('./db/schema'), ExtractTablesWithRelations<typeof import('./db/schema')>>

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Clearing-account path scheme. A member's per-group clearing account nets what the
// group owes them (positive) against what they owe the group (negative) — a single
// receivable account per group. Switched from the legacy `group:<slug>` scheme
// (decided 2026-06-11, categories epic); the merge endpoint re-points old postings.
export const CLEARING_PREFIX = 'assets:receivable'
const LEGACY_CLEARING_PREFIX = 'group:'

export function clearingAccountPath(name: string): string {
  return `${CLEARING_PREFIX}:${slugify(name)}`
}

// True for both the current (`assets:receivable:…`) and legacy (`group:…`) clearing
// account paths. Used where postings are matched by path during the transition window
// (e.g. the import-linked PATCH rebuild) so pre-migration data still resolves.
export function isClearingAccountPath(path: string): boolean {
  return path.startsWith(`${CLEARING_PREFIX}:`) || path.startsWith(LEGACY_CLEARING_PREFIX)
}

// Find or create the clearing (receivable) account for a user in a group.
// Used as the balancing leg for all group expense and settlement auto-postings.
export async function ensureSharedAccount(
  userId: string,
  group: { id: string; name: string },
  tx?: Tx,
): Promise<string> {
  const path = clearingAccountPath(group.name)
  const client = tx ?? db

  const [existing] = await client
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.path, path), isNull(accounts.deletedAt)))

  if (existing) return existing.id

  const [created] = await client
    .insert(accounts)
    .values({ userId, path, name: `Receivable: ${group.name}` })
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
