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

export async function createGroupExpenseInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  opts: {
    group: Group
    members: Member[]
    payerId: string
    description: string
    amount: string
    currency: string
    date: string
    linkedTransactionId?: string
  },
): Promise<string> {
  const { group, members, payerId, description, amount, currency, date, linkedTransactionId } = opts

  const splits = computeSplits(amount, members, payerId)
  const normalizedAmount = parseFloat(amount).toFixed(2)
  const normalizedCurrency = currency.trim().toUpperCase()
  const txDate = new Date(`${date}T00:00:00Z`)

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

  const sharedAccountIds = new Map<string, string>()
  for (const split of splits) {
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
        groupExpenseId: expense.id,
      })
      .returning()

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
