// What needs the user's attention, per account: the sidebar dot, the account page badge and
// its filter. Two signals, unioned into one count per transaction:
//
// - Uncategorized: the transaction has a posting to the user's default offset account
//   (`expenses:uncategorized` at sign-up), which import uses when no rule matched.
// - Malformed cross-currency spends that need repair, attached to the balance accounts they
//   touch (`postings/heal`).

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import { postings, transactions, userSettings } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import { loadHealContext, malformedFxSpendsByAccount } from '../postings/heal-service'
import { accountsOwnedBy } from './ownership-service'

async function offsetAccountOf(userId: string): Promise<string | null> {
  const [settings] = await db
    .select({ defaultOffsetAccountId: userSettings.defaultOffsetAccountId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return settings?.defaultOffsetAccountId ?? null
}

// The condition both queries share: the transaction has a live posting to the offset account.
// Null when no offset account is configured, and callers skip the query. A subquery over
// `postings` rather than an EXISTS correlated with the outer one, because the outer query
// joins `postings` too and a correlated form would need a dialect's `alias()` to tell them
// apart.
function uncategorizedCondition(offsetAccountId: string | null) {
  if (offsetAccountId === null) return null

  return inArray(
    transactions.id,
    db
      .select({ id: postings.transactionId })
      .from(postings)
      .where(and(eq(postings.accountId, offsetAccountId), isNull(postings.deletedAt))),
  )
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
    const rows = await db
      .select({ accountId: postings.accountId, id: transactions.id })
      .from(transactions)
      .innerJoin(
        postings,
        and(eq(postings.transactionId, transactions.id), isNull(postings.deletedAt)),
      )
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), condition))
    for (const r of rows) add(r.accountId, r.id)
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
    const rows = await db
      .selectDistinct({ id: transactions.id })
      .from(transactions)
      .innerJoin(
        postings,
        and(
          eq(postings.transactionId, transactions.id),
          eq(postings.accountId, accountId),
          isNull(postings.deletedAt),
        ),
      )
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), condition))
    for (const r of rows) ids.add(r.id)
  }

  const malformedTransactionIds = [...((await malformedByAccount(userId)).get(accountId) ?? [])]
  for (const id of malformedTransactionIds) ids.add(id)

  const transactionIds = [...ids]
  return {
    ok: true,
    value: { count: transactionIds.length, transactionIds, malformedTransactionIds },
  }
}
