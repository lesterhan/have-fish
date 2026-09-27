// Reading transactions back: the ledger list, and the posting shape every transaction
// endpoint answers with. Writes are in `write-service.ts`.

import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { db } from '../db'
import { accounts, expenseGroups, groupExpenses, postings, transactions } from '../db/schema'
import { underPathCondition } from '../postings/account-type-sql'
import { loadClassifySettings } from '../postings/classify-service'
import { classifyPosting, type PostingRole } from '../postings/roles'
import { spendRows } from '../postings/spend-service'

/**
 * Posting rows (from an insert's `.returning()`) with their account path and name and their
 * role, so a create or replace answers in the same shape as the list. That keeps a single
 * honest `Posting` type on the client and lets a freshly created row be narrated without a
 * refetch. Postings carry `transactionId`, so a flattened list from several transactions can
 * be enriched in one pass and regrouped by the caller.
 */
export async function enrichPostings<T extends { id: string; accountId: string }>(
  userId: string,
  rows: T[],
): Promise<(T & { accountPath: string; accountName: string | null; role: PostingRole })[]> {
  if (rows.length === 0) return []
  const accountIds = [...new Set(rows.map((r) => r.accountId))]
  const accountRows = await db
    .select({ id: accounts.id, path: accounts.path, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(inArray(accounts.id, accountIds), eq(accounts.userId, userId)))
  const byId = new Map(accountRows.map((a) => [a.id, a]))
  const settings = await loadClassifySettings(userId)
  return rows.map((r) => {
    const account = byId.get(r.accountId)
    const accountPath = account?.path ?? ''
    // The classifier reads the account's stored type override; the shape this returns does
    // not carry it. On its own the override is a half-answer — null means "infer from the
    // path", which needs the user's configured roots — and `role` is the whole one. So the
    // classifier gets its own view of the row rather than a field stripped back off.
    const role = classifyPosting(
      { accountId: r.accountId, accountPath, accountType: account?.type ?? null },
      settings,
    )
    return { ...r, accountPath, accountName: account?.name ?? null, role }
  })
}

/** Which transactions the list returns. Dates are inclusive `YYYY-MM-DD`. */
export type TransactionFilter = {
  /** Only transactions with a leg in this account. */
  accountId?: string | undefined
  /** Only transactions with a leg at or under this path; with `spending`, a spend leg. */
  accountPath?: string | undefined
  from?: string | undefined
  to?: string | undefined
  /**
   * Only transactions with a genuine spend leg, by the same definition the spending reports
   * sum (`spend-service`). With it, `accountPath` scopes the spend leg rather than any leg:
   * the list beside a drilled-in category shows what that category's figure is made of.
   */
  spending?: boolean
}

/**
 * The caller's live transactions, newest first, each with its live postings (path, name and
 * role attached) and the name of the Fish Pie group it belongs to, if any.
 *
 * Every transaction in the date range is loaded and then filtered in memory. Fine at
 * household scale; the filters can move into SQL when that stops being true.
 */
export async function listTransactions(userId: string, filter: TransactionFilter) {
  const { accountId, accountPath, from, to, spending } = filter
  const classifySettings = await loadClassifySettings(userId)

  let txRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        from ? gte(transactions.date, from) : undefined,
        to ? lte(transactions.date, to) : undefined,
      ),
    )
    .orderBy(desc(transactions.date))

  if (accountId) {
    // Filter to transactions that have at least one posting for this account
    const postingRows = await db
      .select({ transactionId: postings.transactionId })
      .from(postings)
      .where(eq(postings.accountId, accountId))
    const txIds = [...new Set(postingRows.map((p) => p.transactionId))]
    if (txIds.length === 0) return []
    txRows = txRows.filter((tx) => txIds.includes(tx.id))
  }

  if (spending) {
    const spendTxIds = new Set(
      (
        await spendRows(userId, classifySettings, {
          ...(accountPath ? { prefix: accountPath } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        })
      ).map((r) => r.transactionId),
    )
    txRows = txRows.filter((tx) => spendTxIds.has(tx.id))
  } else if (accountPath) {
    // Match the account itself and all children (e.g. "expenses:food" matches
    // "expenses:food" and "expenses:food:restaurant").
    const matchingAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          isNull(accounts.deletedAt),
          underPathCondition(accountPath),
        ),
      )
    const accountIds = matchingAccounts.map((a) => a.id)
    if (accountIds.length === 0) return []
    const postingRows = await db
      .select({ transactionId: postings.transactionId })
      .from(postings)
      .where(and(inArray(postings.accountId, accountIds), isNull(postings.deletedAt)))
    const txIds = [...new Set(postingRows.map((p) => p.transactionId))]
    if (txIds.length === 0) return []
    txRows = txRows.filter((tx) => txIds.includes(tx.id))
  }

  if (txRows.length === 0) return []

  // Fetch all postings for the matched transactions in one query, joined to their account
  // path so each leg can be classified and rendered without a second lookup.
  const txIds = txRows.map((tx) => tx.id)
  const postingRows = await db
    .select({
      id: postings.id,
      transactionId: postings.transactionId,
      accountId: postings.accountId,
      accountPath: accounts.path,
      accountName: accounts.name,
      // For the role classifier only; stripped before the rows go on the wire, for the
      // reason given in `enrichPostings`.
      accountType: accounts.type,
      amount: postings.amount,
      currency: postings.currency,
      createdAt: postings.createdAt,
      deletedAt: postings.deletedAt,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(inArray(postings.transactionId, txIds), isNull(postings.deletedAt)))
    .orderBy(postings.createdAt)

  // Each posting's role within its transaction (subject/transfer/conversion/fee/share), so
  // the list narrates a complex multi-leg transaction instead of dumping raw legs. Grouped
  // by transaction and embedded, with the classifier's input left off the wire.
  type EmbeddedPosting = Omit<(typeof postingRows)[number], 'accountType'> & { role: PostingRole }
  const postingsByTx = new Map<string, EmbeddedPosting[]>()
  for (const p of postingRows) {
    const { accountType: _classifierInput, ...wire } = p
    const forTx = postingsByTx.get(p.transactionId) ?? []
    forTx.push({ ...wire, role: classifyPosting(p, classifySettings) })
    postingsByTx.set(p.transactionId, forTx)
  }

  // Resolve the group a transaction belongs to via the single forward link
  // (transactions.groupExpenseId). This is total: member transactions and the payer's origin
  // import transaction are all stamped with it, so one lookup answers every row. (The reverse
  // pointer groupExpenses.transactionId still exists, but only marks the origin import line for
  // the edit/delete lifecycle — it is not a read path.)
  const groupExpenseIds = txRows
    .map((tx) => tx.groupExpenseId)
    .filter((id): id is string => id !== null)
  const groupNameByExpenseId = new Map<string, string>()
  if (groupExpenseIds.length > 0) {
    const rows = await db
      .select({ expenseId: groupExpenses.id, groupName: expenseGroups.name })
      .from(groupExpenses)
      .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
      .where(inArray(groupExpenses.id, groupExpenseIds))
    for (const row of rows) groupNameByExpenseId.set(row.expenseId, row.groupName)
  }

  return txRows.map((tx) => ({
    ...tx,
    postings: postingsByTx.get(tx.id) ?? [],
    groupName: tx.groupExpenseId ? (groupNameByExpenseId.get(tx.groupExpenseId) ?? null) : null,
  }))
}
