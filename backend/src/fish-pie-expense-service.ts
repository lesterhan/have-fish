import { db } from './db'
import {
  groupExpenses,
  groupExpenseSplits,
  expenseGroupMembers,
  expenseGroups,
  transactions,
  postings,
} from './db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import { ensureSharedAccount, ensureUncategorizedAccount } from './fish-pie-accounts'

type Group = typeof expenseGroups.$inferSelect
type Member = { userId: string; shareWeight: number; defaultExpenseAccountId: string | null }
type TxDb = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function computeSplits(
  amount: string,
  members: Pick<Member, 'userId' | 'shareWeight'>[],
  payerId: string,
): { userId: string; amount: string }[] {
  if (members.length === 0) throw new Error('cannot split among zero members')
  const total = parseFloat(amount)
  const totalWeight = members.reduce((s, m) => s + m.shareWeight, 0)
  if (totalWeight === 0) throw new Error('total member share weight is zero')

  let remaining = total
  const splits = members.map((m) => {
    const share = Math.round((total * m.shareWeight / totalWeight) * 100) / 100
    remaining = Math.round((remaining - share) * 100) / 100
    return { userId: m.userId, amount: share.toFixed(2) }
  })

  if (remaining !== 0) {
    const payerSplit = splits.find((s) => s.userId === payerId)
    if (payerSplit) payerSplit.amount = (parseFloat(payerSplit.amount) + remaining).toFixed(2)
  }

  return splits
}

// Creates member transactions for each split member.
// Non-payer members always get a 2-posting tx (expense + shared clearing).
// Payer gets a 3-posting tx if paymentAccountId is provided (source - total, group + others, expense + payer share),
// matching the import-path structure. Without paymentAccountId the payer also gets a 2-posting tx (legacy).
// Called from both createGroupExpenseInTx (new expense) and the PATCH edit handler (rebuild after edit).
export async function createMemberTransactionsInTx(
  tx: TxDb,
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
    paymentAccountId?: string
    skipPayerMemberTx?: boolean
  },
): Promise<void> {
  const { expenseId, group, members, splits, description, currency, date, payerId, totalAmount, paymentAccountId, skipPayerMemberTx } = opts
  const normalizedCurrency = currency.trim().toUpperCase()
  const txDate = new Date(`${date}T00:00:00Z`)

  const sharedAccountIds = new Map<string, string>()
  for (const split of splits) {
    if (skipPayerMemberTx && split.userId === payerId) continue
    const member = members.find((m) => m.userId === split.userId)!
    const expenseAccountId =
      member.defaultExpenseAccountId ?? (await ensureUncategorizedAccount(split.userId, tx))

    if (!sharedAccountIds.has(split.userId)) {
      sharedAccountIds.set(split.userId, await ensureSharedAccount(split.userId, group, tx))
    }
    const sharedAccountId = sharedAccountIds.get(split.userId)!

    const [memberTx] = await tx
      .insert(transactions)
      .values({
        userId: split.userId,
        date: txDate,
        description: description.trim(),
        groupExpenseId: expenseId,
      })
      .returning()

    const isPayerWithSource = split.userId === payerId && !!paymentAccountId
    if (isPayerWithSource) {
      // 3-posting payer tx: mirrors the import-path structure.
      // payment: -(total), group: +(others share), expense: +(payer share)
      // When there is only one member (no others), the shared posting is omitted.
      const payerShare = parseFloat(split.amount)
      const othersShare = (parseFloat(totalAmount) - payerShare).toFixed(2)
      const payerPostings: { transactionId: string; accountId: string; amount: string; currency: string }[] = [
        {
          transactionId: memberTx.id,
          accountId: paymentAccountId!,
          amount: (-parseFloat(totalAmount)).toFixed(2),
          currency: normalizedCurrency,
        },
      ]
      if (parseFloat(othersShare) !== 0) {
        payerPostings.push({
          transactionId: memberTx.id,
          accountId: sharedAccountId,
          amount: othersShare,
          currency: normalizedCurrency,
        })
      }
      payerPostings.push({
        transactionId: memberTx.id,
        accountId: expenseAccountId,
        amount: split.amount,
        currency: normalizedCurrency,
      })
      await tx.insert(postings).values(payerPostings)
    } else {
      // 2-posting member tx (non-payer, or payer without source account)
      await tx.insert(postings).values([
        {
          transactionId: memberTx.id,
          accountId: expenseAccountId,
          amount: `-${split.amount}`,
          currency: normalizedCurrency,
        },
        {
          transactionId: memberTx.id,
          accountId: sharedAccountId,
          amount: split.amount,
          currency: normalizedCurrency,
        },
      ])
    }
  }
}

export async function createGroupExpenseInTx(
  tx: TxDb,
  opts: {
    group: Group
    members: Member[]
    payerId: string
    description: string
    amount: string
    currency: string
    date: string
    linkedTransactionId?: string
    // When true, skips creating the payer's member transaction. Used for import-linked
    // expenses where the import tx already records the payer's share as a direct posting.
    skipPayerMemberTx?: boolean
    // Account the payer is paying from. When provided, the payer gets a 3-posting tx
    // (source, group clearing, expense) instead of the legacy 2-posting tx.
    paymentAccountId?: string
  },
): Promise<string> {
  const { group, members, payerId, description, amount, currency, date, linkedTransactionId, skipPayerMemberTx, paymentAccountId } = opts

  const splits = computeSplits(amount, members, payerId)
  const normalizedAmount = parseFloat(amount).toFixed(2)
  const normalizedCurrency = currency.trim().toUpperCase()

  const [expense] = await tx
    .insert(groupExpenses)
    .values({
      groupId: group.id,
      paidByUserId: payerId,
      description: description.trim(),
      amount: normalizedAmount,
      currency: normalizedCurrency,
      date,
      transactionId: linkedTransactionId ?? null,
    })
    .returning()

  await tx.insert(groupExpenseSplits).values(
    splits.map((s) => ({ expenseId: expense.id, userId: s.userId, amount: s.amount })),
  )

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
