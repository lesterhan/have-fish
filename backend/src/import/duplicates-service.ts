import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { db } from '../db'
import {
  accounts,
  expenseGroups,
  groupExpenses,
  groupSettlements,
  postings,
  transactions,
} from '../db/schema'
import { byAccount, candidateWindow, type DuplicateCheckRow, findDuplicate } from './duplicates'

export type PossibleDuplicate = {
  transactionId: string
  date: string
  amount: string
  currency: string
  fishPieKind?: 'expense' | 'settlement'
  fishPieGroupId?: string
  fishPieGroupName?: string
} | null

/**
 * For each row, the transaction already in the caller's ledger that it probably
 * duplicates, or null. The answer lines up with `rows` by index.
 *
 * Rows on an account that isn't the caller's are never matched. A match entered through
 * Fish Pie carries its group, so the review can say "that's the lunch you split" rather
 * than show a bare possible duplicate.
 */
export async function findPossibleDuplicates(
  userId: string,
  rows: readonly DuplicateCheckRow[],
): Promise<PossibleDuplicate[]> {
  const result: PossibleDuplicate[] = rows.map(() => null)

  for (const [accountId, entries] of byAccount(rows)) {
    // Verify the account belongs to this user before querying postings.
    const owned = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)),
      )
      .limit(1)
    if (owned.length === 0) continue

    const { from, to } = candidateWindow(entries.map((e) => e.row.date))
    const existing = await db
      .select({
        transactionId: postings.transactionId,
        date: transactions.date,
        amount: postings.amount,
        currency: postings.currency,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(
          eq(postings.accountId, accountId),
          isNull(postings.deletedAt),
          isNull(transactions.deletedAt),
          gte(transactions.date, from),
          lte(transactions.date, to),
        ),
      )

    for (const { i, row } of entries) {
      const match = findDuplicate(row, existing)
      if (match) {
        result[i] = {
          transactionId: match.transactionId,
          date: match.date.toISOString().substring(0, 10),
          amount: match.amount,
          currency: match.currency,
        }
      }
    }
  }

  await addFishPieContext(result)
  return result
}

/**
 * Stamp each match entered through Fish Pie with its kind and group. A split expense
 * reaches its transactions through `transactions.groupExpenseId` (member and payer
 * transactions, and import transactions since the forward link) or, for older imports,
 * through `groupExpenses.transactionId`; a settlement through its payer or receiver
 * transaction.
 */
async function addFishPieContext(result: PossibleDuplicate[]): Promise<void> {
  const matchedTxIds = result.filter((r) => r !== null).map((r) => r.transactionId)
  if (matchedTxIds.length === 0) return

  type FishPieContext = {
    kind: 'expense' | 'settlement'
    groupId: string
    groupName: string
  }
  const contextByTxId = new Map<string, FishPieContext>()

  const expenseRows = await db
    .select({
      transactionId: transactions.id,
      groupExpenseId: transactions.groupExpenseId,
      groupId: expenseGroups.id,
      groupName: expenseGroups.name,
    })
    .from(transactions)
    .innerJoin(groupExpenses, eq(groupExpenses.id, transactions.groupExpenseId))
    .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
    .where(and(inArray(transactions.id, matchedTxIds), isNull(groupExpenses.deletedAt)))
  for (const row of expenseRows) {
    contextByTxId.set(row.transactionId, {
      kind: 'expense',
      groupId: row.groupId,
      groupName: row.groupName,
    })
  }

  const legacyImportRows = await db
    .select({
      transactionId: groupExpenses.transactionId,
      groupId: expenseGroups.id,
      groupName: expenseGroups.name,
    })
    .from(groupExpenses)
    .innerJoin(expenseGroups, eq(groupExpenses.groupId, expenseGroups.id))
    .where(and(inArray(groupExpenses.transactionId, matchedTxIds), isNull(groupExpenses.deletedAt)))
  for (const row of legacyImportRows) {
    if (!row.transactionId) continue
    contextByTxId.set(row.transactionId, {
      kind: 'expense',
      groupId: row.groupId,
      groupName: row.groupName,
    })
  }

  const settlementRows = await db
    .select({
      payerTransactionId: groupSettlements.payerTransactionId,
      receiverTransactionId: groupSettlements.receiverTransactionId,
      groupId: expenseGroups.id,
      groupName: expenseGroups.name,
    })
    .from(groupSettlements)
    .innerJoin(expenseGroups, eq(groupSettlements.groupId, expenseGroups.id))
    .where(
      and(
        isNull(groupSettlements.deletedAt),
        or(
          inArray(groupSettlements.payerTransactionId, matchedTxIds),
          inArray(groupSettlements.receiverTransactionId, matchedTxIds),
        ),
      ),
    )
  for (const row of settlementRows) {
    const context: FishPieContext = {
      kind: 'settlement',
      groupId: row.groupId,
      groupName: row.groupName,
    }
    if (row.payerTransactionId) contextByTxId.set(row.payerTransactionId, context)
    if (row.receiverTransactionId) contextByTxId.set(row.receiverTransactionId, context)
  }

  for (const entry of result) {
    if (!entry) continue
    const context = contextByTxId.get(entry.transactionId)
    if (context) {
      entry.fishPieKind = context.kind
      entry.fishPieGroupId = context.groupId
      entry.fishPieGroupName = context.groupName
    }
  }
}
