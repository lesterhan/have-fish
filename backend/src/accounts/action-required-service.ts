// What needs the user's attention, per account: the sidebar dot, the account page badge and
// its filter. Two signals, unioned into one count per transaction:
//
// - Uncategorized: the transaction has a posting to the user's default offset account
//   (`expenses:uncategorized` at sign-up), which import uses when no rule matched.
// - Malformed cross-currency spends that need repair, attached to the balance accounts they
//   touch (`postings/heal`).
//
// The two raw `db.execute` queries are the ones #280 moves to the query builder.

import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { userSettings } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import { loadHealContext, malformedFxSpendsByAccount } from '../postings/heal-service'
import { accountsOwnedBy } from './ownership-service'

// Raw row shapes returned by the action-required SQL queries.
type ActionRequiredPairRow = { account_id: string; id: string }
type ActionRequiredIdRow = { id: string }

async function offsetAccountOf(userId: string): Promise<string | null> {
  const [settings] = await db
    .select({ defaultOffsetAccountId: userSettings.defaultOffsetAccountId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return settings?.defaultOffsetAccountId ?? null
}

// The WHERE clause body shared by both queries: the transaction `t` has a live posting to the
// offset account. Null when no offset account is configured, and callers skip the query.
function uncategorizedCondition(offsetAccountId: string | null) {
  if (offsetAccountId === null) return null

  return sql`EXISTS (
    SELECT 1 FROM postings p
    WHERE p.transaction_id = t.id
      AND p.deleted_at IS NULL
      AND p.account_id = ${offsetAccountId}
  )`
}

async function malformedByAccount(userId: string): Promise<Map<string, Set<string>>> {
  const ctx = await loadHealContext(userId)
  return (await malformedFxSpendsByAccount(userId, ctx)).byAccount
}

/**
 * `{ accountId, count }` for every account with at least one transaction needing attention;
 * an account with nothing to fix is left out. A transaction that is both uncategorized and
 * malformed on the same account counts once.
 */
export async function actionRequiredSummary(
  userId: string,
): Promise<{ accountId: string; count: number }[]> {
  const byAccount = new Map<string, Set<string>>()
  const add = (accountId: string, txId: string) => {
    const set = byAccount.get(accountId) ?? new Set<string>()
    set.add(txId)
    byAccount.set(accountId, set)
  }

  const condition = uncategorizedCondition(await offsetAccountOf(userId))
  if (condition) {
    const rows = await db.execute(sql`
      SELECT anchor.account_id, t.id
      FROM transactions t
      JOIN postings anchor ON anchor.transaction_id = t.id AND anchor.deleted_at IS NULL
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND ${condition}
    `)
    for (const r of rows as unknown as ActionRequiredPairRow[]) add(r.account_id, r.id)
  }

  for (const [accountId, txIds] of await malformedByAccount(userId)) {
    for (const txId of txIds) add(accountId, txId)
  }

  return [...byAccount].map(([accountId, txIds]) => ({ accountId, count: txIds.size }))
}

/** The transactions needing attention on one account, and which of them are malformed. */
export type AccountActionRequired = {
  count: number
  transactionIds: string[]
  malformedTransactionIds: string[]
}

/**
 * The same for one account, with the ids. Fetched only when the user turns the filter on;
 * the summary covers the badge.
 */
export async function actionRequiredFor(
  userId: string,
  accountId: string,
): Promise<Outcome<AccountActionRequired>> {
  if (!(await accountsOwnedBy(userId, [accountId]))) {
    return { ok: false, failure: errorBody('ACCOUNT_NOT_FOUND') }
  }

  const ids = new Set<string>()
  const condition = uncategorizedCondition(await offsetAccountOf(userId))
  if (condition) {
    const result = await db.execute(sql`
      SELECT DISTINCT t.id
      FROM transactions t
      JOIN postings anchor ON anchor.transaction_id = t.id
        AND anchor.account_id = ${accountId}
        AND anchor.deleted_at IS NULL
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND ${condition}
    `)
    for (const r of result as unknown as ActionRequiredIdRow[]) ids.add(r.id)
  }

  const malformedTransactionIds = [...((await malformedByAccount(userId)).get(accountId) ?? [])]
  for (const id of malformedTransactionIds) ids.add(id)

  const transactionIds = [...ids]
  return {
    ok: true,
    value: { count: transactionIds.length, transactionIds, malformedTransactionIds },
  }
}
