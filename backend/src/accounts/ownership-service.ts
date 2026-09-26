import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import { accounts } from '../db/schema'

// True when every id is an active account owned by userId. Every route that writes an
// account id a request named (a posting, an import row, a parser default) runs the ids
// through this first, so a write can't land in, or leak the path of, another user's
// account. Empty input is vacuously true; callers reject empties by their own rules.
export async function accountsOwnedBy(userId: string, accountIds: string[]): Promise<boolean> {
  const unique = [...new Set(accountIds)]
  if (unique.length === 0) return true
  const owned = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(inArray(accounts.id, unique), eq(accounts.userId, userId), isNull(accounts.deletedAt)),
    )
  return owned.length === unique.length
}
