import { and, eq, isNull } from 'drizzle-orm'
import { type DbTransaction, db } from './db'
import { returnedRow } from './db/returning'
import {
  expenseGroupMembers,
  expenseGroups,
  groupCategoryMemberAccounts,
  groupCategoryWeights,
  groupExpenseSplits,
  groupExpenses,
  transactions,
} from './db/schema'
import { expenseMemberLegs } from './fish-pie/legs'
import { categoryWeightsFor, computeSplits, payerShareRatio, withWeights } from './fish-pie/splits'
import { ensureSharedAccount, ensureUncategorizedAccount } from './fish-pie-accounts'
import { writeTransaction } from './ledger/write-service'

// Loads and writes a shared expense. The split and each member's legs are pure, in
// `fish-pie/splits.ts` and `fish-pie/legs.ts`.

type Group = typeof expenseGroups.$inferSelect
type Member = { userId: string; shareWeight: number; defaultExpenseAccountId: string | null }

// Resolved category context for one expense: each member's category-mapped expense
// account (overrides their group default) and, when *every* split member has set a
// per-category weight, the category weight map (else null → fall back to group weights).
export type CategoryContext = {
  accounts: Map<string, string> // userId → category-mapped accountId
  weights: ReadonlyMap<string, number> | null // userId → category weight, or null
}

// Load a category's private account mappings and shared weight vector, and decide
// whether the weights apply (`categoryWeightsFor`).
export async function resolveCategoryContext(
  tx: DbTransaction,
  categoryId: string | null | undefined,
  members: { userId: string }[],
): Promise<CategoryContext> {
  if (!categoryId) return { accounts: new Map(), weights: null }

  const [mappings, weightRows] = await Promise.all([
    tx
      .select()
      .from(groupCategoryMemberAccounts)
      .where(eq(groupCategoryMemberAccounts.categoryId, categoryId)),
    tx.select().from(groupCategoryWeights).where(eq(groupCategoryWeights.categoryId, categoryId)),
  ])

  const accounts = new Map<string, string>()
  for (const m of mappings) accounts.set(m.userId, m.accountId)

  const weights = new Map<string, number>()
  for (const w of weightRows) weights.set(w.userId, w.weight)

  return { accounts, weights: categoryWeightsFor(members, weights) }
}

// Resolution order for a member's expense account:
// category mapping → member's group default → their uncategorized account.
export async function resolveExpenseAccountId(
  tx: DbTransaction,
  accounts: Map<string, string>,
  member: Member | undefined,
  userId: string,
): Promise<string> {
  return (
    accounts.get(userId) ??
    member?.defaultExpenseAccountId ??
    (await ensureUncategorizedAccount(userId, tx))
  )
}

// Payer-side values needed to build an import transaction's split directly:
// the payer's category-resolved expense account and their share ratio (category
// weights when they apply, group weights otherwise).
export async function resolvePayerImportContext(
  tx: DbTransaction,
  opts: { categoryId?: string | null | undefined; members: Member[]; payerId: string },
): Promise<{ payerExpenseAccountId: string; payerShareRatio: number }> {
  const { categoryId, members, payerId } = opts
  const ctx = await resolveCategoryContext(tx, categoryId, members)
  const payerMember = members.find((m) => m.userId === payerId)
  const payerExpenseAccountId = await resolveExpenseAccountId(
    tx,
    ctx.accounts,
    payerMember,
    payerId,
  )

  return {
    payerExpenseAccountId,
    payerShareRatio: payerShareRatio(withWeights(members, ctx.weights), payerId),
  }
}

// Creates member transactions for each split member.
// Non-payer members always get a 2-posting tx: expense +share (their spending),
// shared clearing -share (their debt — cleared by the settlement payer leg's +amount).
// Payer gets a 3-posting tx if paymentAccountId is provided (source - total, group + others, expense + payer share),
// matching the import-path structure. Without paymentAccountId the payer gets a legacy
// 2-posting tx with pre-BUG-005 signs (still reachable via PATCH — see BUG-006).
// Called from both createGroupExpenseInTx (new expense) and the PATCH edit handler (rebuild after edit).
export async function createMemberTransactionsInTx(
  tx: DbTransaction,
  opts: {
    expenseId: string
    group: Group
    members: Member[]
    splits: { userId: string; amount: string }[]
    description: string
    currency: string
    date: string
    payerId: string
    totalAmount: string
    paymentAccountId?: string | undefined
    skipPayerMemberTx?: boolean | undefined
    // Category-mapped expense account per member; takes precedence over the member's
    // group default. Empty/omitted → fall back to the default → uncategorized.
    categoryAccounts?: Map<string, string> | undefined
  },
): Promise<void> {
  const {
    expenseId,
    group,
    members,
    splits,
    description,
    currency,
    date,
    payerId,
    totalAmount,
    paymentAccountId,
    skipPayerMemberTx,
    categoryAccounts,
  } = opts
  const normalizedCurrency = currency.trim().toUpperCase()

  const sharedAccountIds = new Map<string, string>()
  for (const split of splits) {
    if (skipPayerMemberTx && split.userId === payerId) continue
    const member = members.find((m) => m.userId === split.userId)!
    const expenseAccountId = await resolveExpenseAccountId(
      tx,
      categoryAccounts ?? new Map(),
      member,
      split.userId,
    )

    if (!sharedAccountIds.has(split.userId)) {
      sharedAccountIds.set(split.userId, await ensureSharedAccount(split.userId, group, tx))
    }
    const sharedAccountId = sharedAccountIds.get(split.userId)!

    // Each member's own transaction, with legs in their own accounts. Written through the
    // ledger service, so the legs are validated like any other transaction's.
    const legs = expenseMemberLegs({
      isPayer: split.userId === payerId,
      paymentAccountId,
      sharedAccountId,
      expenseAccountId,
      share: split.amount,
      totalAmount,
      currency: normalizedCurrency,
    })
    await writeTransaction(tx, split.userId, {
      date,
      description: description.trim(),
      groupExpenseId: expenseId,
      postings: legs,
    })
  }
}

export async function createGroupExpenseInTx(
  tx: DbTransaction,
  opts: {
    group: Group
    members: Member[]
    payerId: string
    description: string
    amount: string
    currency: string
    date: string
    linkedTransactionId?: string | undefined
    // When true, skips creating the payer's member transaction. Used for import-linked
    // expenses where the import tx already records the payer's share as a direct posting.
    skipPayerMemberTx?: boolean | undefined
    // Account the payer is paying from. When provided, the payer gets a 3-posting tx
    // (source, group clearing, expense) instead of the legacy 2-posting tx.
    paymentAccountId?: string | undefined
    // Spending category. Drives per-member expense-account resolution and, when every
    // member has a per-category weight, the split weights.
    categoryId?: string | null | undefined
  },
): Promise<string> {
  const {
    group,
    members,
    payerId,
    description,
    amount,
    currency,
    date,
    linkedTransactionId,
    skipPayerMemberTx,
    paymentAccountId,
    categoryId,
  } = opts

  const ctx = await resolveCategoryContext(tx, categoryId, members)
  const membersForSplit = withWeights(members, ctx.weights)
  const splits = computeSplits(amount, membersForSplit, payerId)
  const normalizedAmount = parseFloat(amount).toFixed(2)
  const normalizedCurrency = currency.trim().toUpperCase()

  const expense = returnedRow(
    await tx
      .insert(groupExpenses)
      .values({
        groupId: group.id,
        categoryId: categoryId ?? null,
        paidByUserId: payerId,
        description: description.trim(),
        amount: normalizedAmount,
        currency: normalizedCurrency,
        date,
        transactionId: linkedTransactionId ?? null,
      })
      .returning(),
    'insert groupExpenses',
  )

  await tx
    .insert(groupExpenseSplits)
    .values(splits.map((s) => ({ expenseId: expense.id, userId: s.userId, amount: s.amount })))

  // Forward link is total: stamp the origin import transaction with group_expense_id too,
  // so every transaction in this expense — member txs and the import tx alike — resolves its
  // group the same way. linkedTransactionId is still recorded on the expense as the "origin
  // import line" marker (preserve it, don't regenerate it on edit), not as the read path.
  if (linkedTransactionId) {
    await tx
      .update(transactions)
      .set({ groupExpenseId: expense.id })
      .where(eq(transactions.id, linkedTransactionId))
  }

  await createMemberTransactionsInTx(tx, {
    expenseId: expense.id,
    group,
    members,
    splits,
    description,
    currency,
    date,
    payerId,
    totalAmount: normalizedAmount,
    paymentAccountId,
    skipPayerMemberTx,
    categoryAccounts: ctx.accounts,
  })

  return expense.id
}

export async function fetchGroupWithMembers(groupId: string) {
  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))

  if (!group) return null

  const members = await db
    .select()
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  return { group, members }
}
