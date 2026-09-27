import { and, eq, isNull } from 'drizzle-orm'
import { CLEARING_PREFIX } from './accounts/paths'
import { db, type Executor } from './db'
import { returnedRow } from './db/returning'
import { accounts } from './db/schema'

// The receivable namespace is a personal-ledger rule (accounts refuse it), so it lives in
// `accounts/paths.ts`; re-exported for the Fish Pie files that already read it from here.
export { CLEARING_PREFIX, isClearingAccountPath } from './accounts/paths'

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function clearingAccountPath(name: string): string {
  return `${CLEARING_PREFIX}:${slugify(name)}`
}

// Find or create the clearing (receivable) account for a user in a group.
// Used as the balancing leg for all group expense and settlement auto-postings.
export async function ensureSharedAccount(
  userId: string,
  group: { id: string; name: string },
  tx?: Executor,
): Promise<string> {
  const path = clearingAccountPath(group.name)
  const client = tx ?? db

  const [existing] = await client
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.path, path), isNull(accounts.deletedAt)))

  if (existing) return existing.id

  const created = returnedRow(
    await client
      .insert(accounts)
      .values({ userId, path, name: `Receivable: ${group.name}` })
      .returning({ id: accounts.id }),
    'insert accounts',
  )

  return created.id
}

// Find or create an uncategorized account for a user.
// Used when a member has no defaultExpenseAccountId configured.
export async function ensureUncategorizedAccount(userId: string, tx?: Executor): Promise<string> {
  const path = 'uncategorized'
  const client = tx ?? db

  const [existing] = await client
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.path, path), isNull(accounts.deletedAt)))

  if (existing) return existing.id

  const created = returnedRow(
    await client
      .insert(accounts)
      .values({ userId, path, name: 'Uncategorized' })
      .returning({ id: accounts.id }),
    'insert accounts',
  )

  return created.id
}
