// Finds or creates the system accounts Fish Pie posts to in a member's own ledger. The
// clearing path itself is pure, in `fish-pie/clearing.ts`.

import { and, eq, isNull } from 'drizzle-orm'
import { pathKey } from './accounts/paths'
import { db, type Executor } from './db'
import { returnedRow } from './db/returning'
import { accounts } from './db/schema'
import { clearingAccountPath } from './fish-pie/clearing'

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
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.pathKey, pathKey(path)),
        isNull(accounts.deletedAt),
      ),
    )

  if (existing) return existing.id

  const created = returnedRow(
    await client
      .insert(accounts)
      .values({ userId, path, pathKey: pathKey(path), name: `Receivable: ${group.name}` })
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
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.pathKey, pathKey(path)),
        isNull(accounts.deletedAt),
      ),
    )

  if (existing) return existing.id

  const created = returnedRow(
    await client
      .insert(accounts)
      .values({ userId, path, pathKey: pathKey(path), name: 'Uncategorized' })
      .returning({ id: accounts.id }),
    'insert accounts',
  )

  return created.id
}
