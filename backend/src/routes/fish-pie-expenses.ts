import { Hono } from 'hono'
import { db } from '../db'
import { groupExpenses, groupExpenseSplits, expenseGroupMembers, expenseGroups, transactions, postings, accounts, user } from '../db/schema'
import { eq, isNull, and, inArray, desc } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { computeSplits, createGroupExpenseInTx, createMemberTransactionsInTx } from '../fish-pie-expense-service'
import { ensureUncategorizedAccount } from '../fish-pie-accounts'

const app = new Hono<{ Variables: AppVariables }>()

async function fetchExpenseWithDetails(expenseIds: string[]) {
  if (expenseIds.length === 0) return []

  const [expenses, splits] = await Promise.all([
    db.select().from(groupExpenses).where(inArray(groupExpenses.id, expenseIds)),
    // Join through groupExpenses → expenseGroupMembers → accounts to get each
    // member's configured expense account path for the delete impact dialog.
    db
      .select({
        id: groupExpenseSplits.id,
        expenseId: groupExpenseSplits.expenseId,
        userId: groupExpenseSplits.userId,
        amount: groupExpenseSplits.amount,
        userName: user.name,
        expenseAccountPath: accounts.path,
      })
      .from(groupExpenseSplits)
      .innerJoin(user, eq(groupExpenseSplits.userId, user.id))
      .innerJoin(groupExpenses, eq(groupExpenseSplits.expenseId, groupExpenses.id))
      .leftJoin(
        expenseGroupMembers,
        and(
          eq(expenseGroupMembers.groupId, groupExpenses.groupId),
          eq(expenseGroupMembers.userId, groupExpenseSplits.userId),
        ),
      )
      .leftJoin(accounts, eq(accounts.id, expenseGroupMembers.defaultExpenseAccountId))
      .where(inArray(groupExpenseSplits.expenseId, expenseIds)),
  ])

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

  const expenseId = await db.transaction((tx) =>
    createGroupExpenseInTx(tx, {
      group,
      members,
      payerId,
      description: body.description!,
      amount: body.amount!,
      currency: body.currency!,
      date: body.date!,
    }),
  )

  const [withDetails] = await fetchExpenseWithDetails([expenseId])
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

// PATCH /api/fish-pie/groups/:groupId/expenses/:expenseId
app.patch('/groups/:groupId/expenses/:expenseId', async (c) => {
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

  const members = await db
    .select()
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  const body = await c.req.json<{
    description?: string
    amount?: string
    currency?: string
    date?: string
    paidByUserId?: string
    splits?: { userId: string; shareWeight: number }[]
  }>()

  const description = body.description?.trim() ?? expense.description
  const amount = body.amount ?? expense.amount
  const currency = body.currency?.trim().toUpperCase() ?? expense.currency
  const date = body.date ?? expense.date
  const payerId = body.paidByUserId ?? expense.paidByUserId

  if (!description) return c.json({ error: 'description is required' }, 400)
  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return c.json({ error: 'amount must be a positive number' }, 400)
  if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (!members.some((m) => m.userId === payerId)) return c.json({ error: 'payer is not a member' }, 400)

  // Apply optional per-expense split weight overrides (defaults to stored member weights)
  const membersForSplit = body.splits
    ? members.map((m) => ({
        ...m,
        shareWeight: body.splits!.find((s) => s.userId === m.userId)?.shareWeight ?? m.shareWeight,
      }))
    : members

  const now = new Date()

  await db.transaction(async (tx) => {
    // Soft-delete existing member transactions + their postings (NOT the import tx)
    const memberTxRows = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.groupExpenseId, expenseId), isNull(transactions.deletedAt)))
    const memberTxIds = memberTxRows.map((t) => t.id)
    if (memberTxIds.length > 0) {
      await tx.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, memberTxIds))
      await tx.update(postings).set({ deletedAt: now }).where(inArray(postings.transactionId, memberTxIds))
    }

    // Update groupExpenses row in-place
    await tx
      .update(groupExpenses)
      .set({ description, amount: parseFloat(amount).toFixed(2), currency, date, paidByUserId: payerId })
      .where(eq(groupExpenses.id, expenseId))

    // Hard-delete old splits (no deletedAt on groupExpenseSplits) and insert recomputed ones
    const splits = computeSplits(amount, membersForSplit, payerId)
    await tx.delete(groupExpenseSplits).where(eq(groupExpenseSplits.expenseId, expenseId))
    await tx.insert(groupExpenseSplits).values(
      splits.map((s) => ({ expenseId, userId: s.userId, amount: s.amount })),
    )

    // Recreate member transactions with updated values
    await createMemberTransactionsInTx(tx, {
      expenseId,
      group,
      members,
      splits,
      description,
      currency,
      date,
      payerId,
      skipPayerMemberTx: !!expense.transactionId,
    })

    // If import-linked: update the split postings on the import transaction
    if (expense.transactionId) {
      const oldPayerMember = members.find((m) => m.userId === expense.paidByUserId)!
      const oldExpenseAccountId =
        oldPayerMember.defaultExpenseAccountId ?? (await ensureUncategorizedAccount(expense.paidByUserId, tx))

      const newPayerMember = members.find((m) => m.userId === payerId)!
      const newExpenseAccountId =
        newPayerMember.defaultExpenseAccountId ?? (await ensureUncategorizedAccount(payerId, tx))

      const importPostings = await tx
        .select({
          id: postings.id,
          amount: postings.amount,
          currency: postings.currency,
          accountId: postings.accountId,
          accountPath: accounts.path,
        })
        .from(postings)
        .innerJoin(accounts, eq(postings.accountId, accounts.id))
        .where(and(eq(postings.transactionId, expense.transactionId), isNull(postings.deletedAt)))

      const groupPosting = importPostings.find((p) => p.accountPath.startsWith('group:'))
      const expensePosting = importPostings.find((p) => p.accountId === oldExpenseAccountId)

      if (groupPosting && expensePosting) {
        await tx
          .update(postings)
          .set({ deletedAt: now })
          .where(inArray(postings.id, [groupPosting.id, expensePosting.id]))

        // Both postings share the same sign; their sum is the net target amount
        const netTarget = parseFloat(groupPosting.amount) + parseFloat(expensePosting.amount)
        const totalWeight = membersForSplit.reduce((s, m) => s + m.shareWeight, 0)
        const payerWeight = membersForSplit.find((m) => m.userId === payerId)?.shareWeight ?? 1
        const newPayerShare = (netTarget * (payerWeight / totalWeight)).toFixed(2)
        const newOthersShare = (netTarget - parseFloat(newPayerShare)).toFixed(2)
        const targetCurrency = groupPosting.currency

        await tx.insert(postings).values([
          {
            transactionId: expense.transactionId,
            accountId: groupPosting.accountId,
            amount: newOthersShare,
            currency: targetCurrency,
          },
          {
            transactionId: expense.transactionId,
            accountId: newExpenseAccountId,
            amount: newPayerShare,
            currency: targetCurrency,
          },
        ])
      }
    }
  })

  const [withDetails] = await fetchExpenseWithDetails([expenseId])
  return c.json(withDetails)
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

    const linkedTxs = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expenseId))

    // Also include the import transaction if this expense was created via CSV import.
    // That transaction links in the opposite direction (groupExpenses.transactionId) so
    // the groupExpenseId query above misses it.
    const txIds = linkedTxs.map((t) => t.id)
    if (expense.transactionId) txIds.push(expense.transactionId)

    if (txIds.length > 0) {
      await tx.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, txIds))
      await tx.update(postings).set({ deletedAt: now }).where(inArray(postings.transactionId, txIds))
    }
  })
  return new Response(null, { status: 204 })
})

// DELETE /api/fish-pie/group-expenses/:expenseId
// Convenience endpoint: removes expense without requiring the group ID in the URL.
app.delete('/group-expenses/:expenseId', async (c) => {
  const userId = c.get('userId')
  const expenseId = c.req.param('expenseId')

  const [expense] = await db
    .select()
    .from(groupExpenses)
    .where(and(eq(groupExpenses.id, expenseId), isNull(groupExpenses.deletedAt)))
  if (!expense) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, expense.groupId))
  if (!group) return c.json({ error: 'not found' }, 404)

  const isPayer = expense.paidByUserId === userId
  const isCreator = group.createdBy === userId
  if (!isPayer && !isCreator) return c.json({ error: 'forbidden' }, 403)

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(groupExpenses).set({ deletedAt: now }).where(eq(groupExpenses.id, expenseId))

    const linkedTxs = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expenseId))

    const txIds = linkedTxs.map((t) => t.id)
    if (expense.transactionId) txIds.push(expense.transactionId)

    if (txIds.length > 0) {
      await tx.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, txIds))
      await tx.update(postings).set({ deletedAt: now }).where(inArray(postings.transactionId, txIds))
    }
  })
  return new Response(null, { status: 204 })
})

export default app
