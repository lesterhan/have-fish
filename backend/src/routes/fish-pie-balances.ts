import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroups, expenseGroupMembers, groupExpenses, groupExpenseSplits, groupSettlements, user } from '../db/schema'
import { eq, isNull, and, inArray } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { computeCurrencyBalances } from '../fish-pie-balance-service'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/fish-pie/groups/:groupId/balances
app.get('/groups/:groupId/balances', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await db
    .select({ userId: expenseGroupMembers.userId, userName: user.name })
    .from(expenseGroupMembers)
    .innerJoin(user, eq(expenseGroupMembers.userId, user.id))
    .where(eq(expenseGroupMembers.groupId, groupId))

  if (!members.some((m) => m.userId === userId)) return c.json({ error: 'not found' }, 404)
  if (members.length === 0) return c.json([])

  const [expenseRows, settlements] = await Promise.all([
    db
      .select({ id: groupExpenses.id, paidByUserId: groupExpenses.paidByUserId, amount: groupExpenses.amount, currency: groupExpenses.currency })
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt))),
    db
      .select({ fromUserId: groupSettlements.fromUserId, toUserId: groupSettlements.toUserId, amount: groupSettlements.amount, currency: groupSettlements.currency })
      .from(groupSettlements)
      .where(and(eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt), eq(groupSettlements.status, 'completed'))),
  ])

  if (expenseRows.length === 0 && settlements.length === 0) return c.json([])

  const expenseIds = expenseRows.map((e) => e.id)
  const splits = expenseIds.length > 0
    ? await db
        .select({ expenseId: groupExpenseSplits.expenseId, userId: groupExpenseSplits.userId, amount: groupExpenseSplits.amount })
        .from(groupExpenseSplits)
        .where(inArray(groupExpenseSplits.expenseId, expenseIds))
    : []

  // Attach splits to their expense (O(n) via a map) so the shared balance
  // computation gets the same expense-with-splits shape the overview uses.
  const splitsByExpense = new Map<string, { userId: string; amount: string }[]>()
  for (const s of splits) {
    const list = splitsByExpense.get(s.expenseId) ?? []
    list.push({ userId: s.userId, amount: s.amount })
    splitsByExpense.set(s.expenseId, list)
  }
  const expenses = expenseRows.map((e) => ({ ...e, splits: splitsByExpense.get(e.id) ?? [] }))

  return c.json(computeCurrencyBalances(members, expenses, settlements))
})

export default app
