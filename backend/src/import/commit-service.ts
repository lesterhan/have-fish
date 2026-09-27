import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { type DbTransaction, db } from '../db'
import { groupCategories } from '../db/schema'
import { type ErrorBody, errorBody, type Outcome } from '../errors'
import { ensureSharedAccount } from '../fish-pie-accounts'
import {
  createGroupExpenseInTx,
  fetchGroupWithMembers,
  resolvePayerImportContext,
} from '../fish-pie-expense-service'
import { inLedgerTransaction, writeTransaction } from '../ledger/write-service'
import {
  checkRows,
  type ImportRowInput,
  namedAccountIds,
  planRows,
  type SplitContext,
  takesSplit,
} from './commit-plan'

/** A row the user chose to split with a Fish Pie group, and the category if any. */
export type GroupSplitInput = {
  rowIndex: number
  groupId: string
  categoryId?: string | null | undefined
}

type Group = NonNullable<Awaited<ReturnType<typeof fetchGroupWithMembers>>>

/**
 * Write every row of an import as one unit: all of them, or none and the reason.
 *
 * In order, and each refusal is the answer:
 *
 * 1. Each split names a row that exists, a group the caller belongs to, and an active
 *    category of that group.
 * 2. Each row names the accounts its kind needs (`checkRows`).
 * 3. Every account named is the caller's.
 * 4. In one database transaction: find or create what each split row needs from Fish Pie,
 *    plan every row (`planRows`), then write each through the ledger service, which
 *    validates its legs, and create the group expense for a split row. A refused row rolls
 *    back every row, the clearing accounts included, and answers with its index.
 */
export async function commitImport(
  userId: string,
  request: {
    accountId: string | null | undefined
    defaultCurrency: string
    rows: readonly ImportRowInput[]
    splits: readonly GroupSplitInput[]
  },
): Promise<Outcome<{ created: number; fishPieExpenses: number }>> {
  const { accountId, defaultCurrency, rows, splits } = request

  const groups = await checkSplits(userId, splits, rows.length)
  if (!groups.ok) return groups

  const splitByRowIndex = new Map(splits.map((s) => [s.rowIndex, s]))
  const checked = checkRows(rows, { accountId, splitRows: new Set(splitByRowIndex.keys()) })
  if (!checked.ok) return checked

  if (!(await accountsOwnedBy(userId, namedAccountIds(accountId, rows)))) {
    return { ok: false, failure: errorBody('ACCOUNTS_NOT_FOUND') }
  }

  const written = await inLedgerTransaction(async (tx) => {
    // Loaded in row order, before any row is written; finding or creating the clearing
    // account is idempotent, so doing it up front gives each row what it got before.
    const splitContexts = new Map<number, SplitContext>()
    for (const [rowIndex, row] of checked.value.entries()) {
      const split = splitByRowIndex.get(rowIndex)
      if (!split || !takesSplit(row)) continue
      splitContexts.set(rowIndex, await loadSplitContext(tx, userId, split, groups.value))
    }

    const plan = planRows(checked.value, {
      accountId,
      defaultCurrency,
      splits: splitContexts,
      newId: randomUUID,
    })

    let fishPieExpenses = 0
    for (const row of plan) {
      await writeTransaction(tx, userId, row.transaction, { index: row.index })
      if (row.groupExpense) {
        const { group, members } = groupOf(groups.value, row.groupExpense.groupId)
        await createGroupExpenseInTx(tx, {
          group,
          members,
          payerId: userId,
          description: row.groupExpense.description,
          amount: row.groupExpense.amount,
          currency: row.groupExpense.currency,
          date: row.groupExpense.date,
          linkedTransactionId: row.transaction.id,
          skipPayerMemberTx: true,
          categoryId: row.groupExpense.categoryId,
        })
        fishPieExpenses++
      }
    }
    return fishPieExpenses
  })
  if (!written.ok) return written

  return { ok: true, value: { created: rows.length, fishPieExpenses: written.value } }
}

/**
 * Check every split before anything is written, in the order they were sent, and load each
 * group once. Import is a create flow, so an archived category is refused.
 */
async function checkSplits(
  userId: string,
  splits: readonly GroupSplitInput[],
  rowCount: number,
): Promise<Outcome<Map<string, Group>>> {
  const groups = new Map<string, Group>()
  for (const split of splits) {
    if (split.rowIndex < 0 || split.rowIndex >= rowCount) {
      return refuse(errorBody('GROUP_SPLIT_ROW_OUT_OF_RANGE', { rowIndex: split.rowIndex }))
    }
    if (!groups.has(split.groupId)) {
      const result = await fetchGroupWithMembers(split.groupId)
      if (!result) return refuse(errorBody('GROUP_NOT_FOUND', { groupId: split.groupId }))
      if (!result.members.some((m) => m.userId === userId)) {
        return refuse(errorBody('NOT_A_GROUP_MEMBER', { groupId: split.groupId }))
      }
      groups.set(split.groupId, result)
    }
    if (split.categoryId) {
      const [cat] = await db
        .select({ id: groupCategories.id, archivedAt: groupCategories.archivedAt })
        .from(groupCategories)
        .where(
          and(eq(groupCategories.id, split.categoryId), eq(groupCategories.groupId, split.groupId)),
        )
      if (!cat) {
        return refuse(
          errorBody('CATEGORY_NOT_IN_GROUP', {
            categoryId: split.categoryId,
            groupId: split.groupId,
          }),
        )
      }
      if (cat.archivedAt) {
        return refuse(errorBody('CATEGORY_ARCHIVED', { categoryId: split.categoryId }))
      }
    }
  }
  return { ok: true, value: groups }
}

/**
 * What one split row needs from Fish Pie, inside the unit of work: the group's clearing
 * account in the caller's ledger (created the first time), and the caller's expense
 * account and share for the row's category.
 */
async function loadSplitContext(
  tx: DbTransaction,
  userId: string,
  split: GroupSplitInput,
  groups: ReadonlyMap<string, Group>,
): Promise<SplitContext> {
  const { group, members } = groupOf(groups, split.groupId)
  const groupAccountId = await ensureSharedAccount(userId, group, tx)
  const { payerExpenseAccountId, payerShareRatio } = await resolvePayerImportContext(tx, {
    categoryId: split.categoryId,
    members,
    payerId: userId,
  })
  return {
    groupId: split.groupId,
    categoryId: split.categoryId ?? null,
    groupAccountId,
    payerExpenseAccountId,
    payerShareRatio,
  }
}

function groupOf(groups: ReadonlyMap<string, Group>, groupId: string): Group {
  const group = groups.get(groupId)
  // `checkSplits` loaded every group a split names, so a miss means they have drifted apart.
  if (!group) throw new Error(`import split names group ${groupId}, which was not loaded`)
  return group
}

function refuse(failure: ErrorBody): Outcome<never> {
  return { ok: false, failure }
}
