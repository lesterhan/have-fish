import { Hono } from 'hono'
import { db } from '../db'
import { groupExpenses, groupExpenseSplits, expenseGroupMembers, expenseGroups, transactions, postings, user } from '../db/schema'
import { eq, isNull, and, inArray, desc } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { ensureSharedAccount, ensureUncategorizedAccount } from '../fish-pie-accounts'

const app = new Hono<{ Variables: AppVariables }>()

// Compute splits from member weights. Rounding remainder goes to payer.
function computeSplits(
  amount: string,
  members: { userId: string; shareWeight: number }[],
  payerId: string,
): { userId: string; amount: string }[] {
  const total = parseFloat(amount)
  const totalWeight = members.reduce((s, m) => s + m.shareWeight, 0)

  let remaining = total
  const splits = members.map((m) => {
    const share = Math.round((total * m.shareWeight / totalWeight) * 100) / 100
    remaining = Math.round((remaining - share) * 100) / 100
    return { userId: m.userId, amount: share.toFixed(2) }
  })

  // Add rounding remainder to payer's split
  if (remaining !== 0) {
    const payerSplit = splits.find((s) => s.userId === payerId)
    if (payerSplit) {
      payerSplit.amount = (parseFloat(payerSplit.amount) + remaining).toFixed(2)
    }
  }

  return splits
}

async function fetchExpenseWithDetails(expenseIds: string[]) {
  if (expenseIds.length === 0) return []

  const [expenses, splits] = await Promise.all([
    db.select().from(groupExpenses).where(inArray(groupExpenses.id, expenseIds)),
    db
      .select({
        id: groupExpenseSplits.id,
        expenseId: groupExpenseSplits.expenseId,
        userId: groupExpenseSplits.userId,
        amount: groupExpenseSplits.amount,
        userName: user.name,
      })
      .from(groupExpenseSplits)
      .innerJoin(user, eq(groupExpenseSplits.userId, user.id))
      .where(inArray(groupExpenseSplits.expenseId, expenseIds)),
  ])

  // Fetch only the payer names needed
  const payerIds = [...new Set(expenses.map((e) => e.paidByUserId))]
  const payers = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, payerIds))
  const userMap = new Map(payers.map((u) => [u.id, u.name]))

  return expenses.map((e) => ({
    ...e,
    payerName: userMap.get(e.paidByUserId) ?? null,
    splits: splits.filter((s) => s.expenseId === e.id),
  }))
}

// POST /api/fish-pie/groups/:groupId/expenses
app.post('/groups/:groupId/expenses', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await db
    .select()
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  if (!members.some((m) => m.userId === userId)) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{
    description?: string
    amount?: string
    currency?: string
    date?: string
    paidByUserId?: string
  }>()

  if (!body.description?.trim()) return c.json({ error: 'description is required' }, 400)
  if (!body.amount || isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0)
    return c.json({ error: 'amount must be a positive number' }, 400)
  if (!body.currency?.trim()) return c.json({ error: 'currency is required' }, 400)
  if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)

  const payerId = body.paidByUserId ?? userId
  if (!members.some((m) => m.userId === payerId)) return c.json({ error: 'payer is not a member' }, 400)

  const splits = computeSplits(body.amount, members, payerId)

  const expense = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(groupExpenses)
      .values({
        groupId,
        paidByUserId: payerId,
        description: body.description!.trim(),
        amount: parseFloat(body.amount!).toFixed(2),
        currency: body.currency!.trim().toUpperCase(),
        date: body.date!,
      })
      .returning()

    await tx.insert(groupExpenseSplits).values(
      splits.map((s) => ({ expenseId: e.id, userId: s.userId, amount: s.amount })),
    )

    // Auto-post each member's share to their configured expense account.
    // Debit: member's expense account (negative = money leaving)
    // Credit: shared:<group> account (positive = balance owed/receivable)
    const sharedAccountIds = new Map<string, string>()
    for (const split of splits) {
      const member = members.find((m) => m.userId === split.userId)!
      const expenseAccountId = member.defaultExpenseAccountId
        ?? await ensureUncategorizedAccount(split.userId, tx)

      if (!sharedAccountIds.has(split.userId)) {
        sharedAccountIds.set(split.userId, await ensureSharedAccount(split.userId, group, tx))
      }
      const sharedAccountId = sharedAccountIds.get(split.userId)!

      const txDate = new Date(`${body.date!}T00:00:00Z`)
      const [t] = await tx
        .insert(transactions)
        .values({
          userId: split.userId,
          date: txDate,
          description: body.description!.trim(),
          groupExpenseId: e.id,
        })
        .returning()

      await tx.insert(postings).values([
        { transactionId: t.id, accountId: expenseAccountId, amount: (-parseFloat(split.amount)).toFixed(2), currency: body.currency!.trim().toUpperCase() },
        { transactionId: t.id, accountId: sharedAccountId, amount: split.amount, currency: body.currency!.trim().toUpperCase() },
      ])
    }

    return e
  })

  const [withDetails] = await fetchExpenseWithDetails([expense.id])
  return c.json(withDetails, 201)
})

// GET /api/fish-pie/groups/:groupId/expenses
app.get('/groups/:groupId/expenses', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const [membership] = await db
    .select()
    .from(expenseGroupMembers)
    .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, userId)))
  if (!membership) return c.json({ error: 'not found' }, 404)

  const expenses = await db
    .select()
    .from(groupExpenses)
    .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
    .orderBy(desc(groupExpenses.date), desc(groupExpenses.createdAt))

  if (expenses.length === 0) return c.json([])
  return c.json(await fetchExpenseWithDetails(expenses.map((e) => e.id)))
})

// DELETE /api/fish-pie/groups/:groupId/expenses/:expenseId
app.delete('/groups/:groupId/expenses/:expenseId', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const expenseId = c.req.param('expenseId')

  const [expense] = await db
    .select()
    .from(groupExpenses)
    .where(and(eq(groupExpenses.id, expenseId), eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
  if (!expense) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, groupId))
  if (!group) return c.json({ error: 'not found' }, 404)

  const isPayer = expense.paidByUserId === userId
  const isCreator = group.createdBy === userId
  if (!isPayer && !isCreator) return c.json({ error: 'forbidden' }, 403)

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(groupExpenses).set({ deletedAt: now }).where(eq(groupExpenses.id, expenseId))

    // Soft-delete all auto-created transactions for this expense (one per member).
    const linkedTxs = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expenseId))

    if (linkedTxs.length > 0) {
      const txIds = linkedTxs.map((t) => t.id)
      await tx.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, txIds))
      await tx.update(postings).set({ deletedAt: now }).where(inArray(postings.transactionId, txIds))
    }
  })
  return new Response(null, { status: 204 })
})

export default app
