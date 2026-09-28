// The account rows themselves: list, read, create, rename a subtree, update, soft-delete.
// Path rules are in `paths.ts`; this loads what they need and writes what they decide.

import { and, count, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { accounts, postings, transactions, userSettings } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import {
  type AccountTypeContext,
  explainType,
  resolveStoredOrInferredType,
  tagsFrom,
} from '../postings/account-type'
import { loadAccountTypeContext, loadAccountTypeRoots } from '../postings/classify-service'
import { isClearingAccountPath, planRename } from './paths'

type AccountRow = typeof accounts.$inferSelect

/** The columns a caller may set on an account besides its path. */
export type AccountFields = Partial<Pick<AccountRow, 'name' | 'defaultCurrency' | 'type'>>

/**
 * Every active account, with `resolvedType`: its own override, else a tagged ancestor's,
 * else path inference. The UI and the journal export share that one answer; `type` stays the
 * raw stored override.
 */
export async function listAccounts(userId: string) {
  const all = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  // Every account is already in hand, so the tags come from these rows.
  const ctx = { ...(await loadAccountTypeRoots(userId)), tagged: tagsFrom(all) }
  return all.map((a) => ({ ...a, resolvedType: resolveStoredOrInferredType(a, ctx) }))
}

// An account with the effective type and what "Auto" would pick — the type it would have
// with no override of its own, and the tagged ancestor that answer came from, if any — so the
// settings UI can show "Auto (Expense, from 花钱)" beside an explicit override. The single
// read and the update both answer with this shape.
function withResolvedTypes<T extends { path: string; type: string | null }>(
  account: T,
  ctx: AccountTypeContext,
) {
  const auto = explainType({ path: account.path, type: null }, ctx)
  return {
    ...account,
    resolvedType: resolveStoredOrInferredType(account, ctx),
    inferredType: auto?.type ?? null,
    inheritedFrom: auto?.from === 'ancestor' ? auto.path : null,
  }
}

export type AccountWithTypes = ReturnType<typeof withResolvedTypes<AccountRow>>

/** One active account of the caller's, with its resolved, inferred and inherited type. */
export async function getAccount(
  userId: string,
  accountId: string,
): Promise<Outcome<AccountWithTypes>> {
  const [found] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!found) return { ok: false, failure: errorBody('ACCOUNT_NOT_FOUND') }
  return { ok: true, value: withResolvedTypes(found, await loadAccountTypeContext(userId)) }
}

/**
 * Create one account. The path's shape is the caller's to check (the route's schema does);
 * the receivable namespace is refused here. Clearing accounts are re-spawned by Fish Pie, so
 * the rename refuses to move an account into that namespace, and creating one there directly
 * would be the same hole by another door.
 */
export async function createAccount(
  userId: string,
  fields: { path: string } & AccountFields,
): Promise<Outcome<AccountRow>> {
  if (isClearingAccountPath(fields.path)) {
    return { ok: false, failure: errorBody('RECEIVABLE_NOT_CREATABLE') }
  }
  const created = await db
    .insert(accounts)
    .values({ ...fields, userId })
    .returning()
  return { ok: true, value: returnedRow(created, 'insert accounts') }
}

/**
 * Rename the prefix `from` to `to` across the node and every descendant, in one database
 * transaction; `planRename` decides what moves and what is refused. Postings are untouched:
 * they reference the stable `accounts.id`.
 */
export async function renameAccounts(
  userId: string,
  from: string,
  to: string,
): Promise<Outcome<{ renamed: number; accounts: AccountRow[] }>> {
  const all = await db
    .select({ id: accounts.id, path: accounts.path })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))

  const plan = planRename(all, from, to)
  if (!plan.ok) return plan

  const updated = await db.transaction(async (tx) => {
    const out: AccountRow[] = []
    for (const r of plan.value) {
      const rows = await tx
        .update(accounts)
        .set({ path: r.newPath })
        .where(and(eq(accounts.id, r.id), eq(accounts.userId, userId)))
        .returning()
      out.push(returnedRow(rows, 'update accounts'))
    }
    return out
  })
  return { ok: true, value: { renamed: updated.length, accounts: updated } }
}

/** Set name, currency or type override on one active account of the caller's. */
export async function updateAccount(
  userId: string,
  accountId: string,
  fields: AccountFields,
): Promise<Outcome<AccountWithTypes>> {
  const [updated] = await db
    .update(accounts)
    .set(fields)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .returning()
  if (!updated) return { ok: false, failure: errorBody('ACCOUNT_NOT_FOUND') }
  return { ok: true, value: withResolvedTypes(updated, await loadAccountTypeContext(userId)) }
}

/**
 * Soft-delete an account, but only one nothing depends on. Deleting unconditionally made
 * three quiet ways to lose data: an account with postings vanishes from every list while its
 * entries keep pointing at it; a default offset / conversion / adjustments account leaves
 * the pointer dangling and breaks the next import; and a receivable account is re-spawned by
 * Fish Pie anyway. The UI guards all three, but a guard that only exists in the client is a
 * guard the next client forgets.
 *
 * The subtree is deliberately *not* guarded: paths are materialized, so a parent row with
 * live children simply reverts to a virtual grouping node in the tree. Nothing is lost.
 */
export async function deleteAccount(userId: string, accountId: string): Promise<Outcome<void>> {
  const [account] = await db
    .select({ path: accounts.path })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!account) return { ok: false, failure: errorBody('ACCOUNT_NOT_FOUND') }

  if (isClearingAccountPath(account.path)) {
    return { ok: false, failure: errorBody('RECEIVABLE_NOT_DELETABLE') }
  }

  // Postings on a soft-deleted transaction do not count — the entry is already gone, so the
  // account is free. Same rule `postingCounts` uses, so the count the UI shows and the count
  // this refuses on are the same number.
  const [{ entries } = { entries: 0 }] = await db
    .select({ entries: count(transactions.id) })
    .from(postings)
    .innerJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt)),
    )
    .where(and(eq(postings.accountId, accountId), isNull(postings.deletedAt)))
  if (entries > 0) {
    return { ok: false, failure: errorBody('ACCOUNT_HAS_ENTRIES', { entries }) }
  }

  const [roles] = await db
    .select({
      offset: userSettings.defaultOffsetAccountId,
      conversion: userSettings.defaultConversionAccountId,
      adjustments: userSettings.defaultAdjustmentsAccountId,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  const held = [
    roles?.offset === accountId ? 'offset' : null,
    roles?.conversion === accountId ? 'conversion' : null,
    roles?.adjustments === accountId ? 'adjustments' : null,
  ].filter((r): r is string => r !== null)
  if (held.length > 0) {
    return { ok: false, failure: errorBody('ACCOUNT_IS_A_DEFAULT', { roles: held }) }
  }

  await db
    .update(accounts)
    .set({ deletedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  return { ok: true, value: undefined }
}
