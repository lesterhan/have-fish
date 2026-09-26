import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, type Executor } from '../db'
import { accounts } from '../db/schema'

// True when every id is an account owned by userId. Every route that writes an account id
// a request named (a posting, an import row, a parser default) runs the ids through this
// first, so a write can't land in, or leak the path of, another user's account. Empty input
// is vacuously true; callers reject empties by their own rules.
//
// By default the accounts must also be active, because a request naming a deleted account
// is a mistake to refuse. `includeDeleted` is for legs the code built itself from stored
// settings (Fish Pie reads each member's defaults), where the question is only whose
// account it is. `executor` lets the check see accounts the caller's open transaction has
// just created, which a separate connection could not.
export async function accountsOwnedBy(
  userId: string,
  accountIds: string[],
  options: { executor?: Executor; includeDeleted?: boolean } = {},
): Promise<boolean> {
  const unique = [...new Set(accountIds)]
  if (unique.length === 0) return true
  const exec = options.executor ?? db
  const owned = await exec
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        inArray(accounts.id, unique),
        eq(accounts.userId, userId),
        options.includeDeleted ? undefined : isNull(accounts.deletedAt),
      ),
    )
  return owned.length === unique.length
}
