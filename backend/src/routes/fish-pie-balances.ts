import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroups, expenseGroupMembers, groupExpenses, groupExpenseSplits, groupSettlements, user } from '../db/schema'
import { eq, isNull, and, inArray } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

type Transfer = {
  fromUserId: string
  fromUserName: string | null
  toUserId: string
  toUserName: string | null
  amount: string
  currency: string
}

type CurrencyBalance = {
  currency: string
  netPositions: { userId: string; userName: string | null; amount: string }[]
  transfers: Transfer[]
}

// Greedy creditor/debtor matching — produces minimal transfer set.
// Positive net = creditor (owed money), negative net = debtor (owes money).
function simplifyDebts(
  nets: { userId: string; userName: string | null; net: number }[],
): { fromUserId: string; fromUserName: string | null; toUserId: string; toUserName: string | null; amount: number }[] {
  const creditors = nets.filter((n) => n.net > 0.005).map((n) => ({ ...n, remaining: n.net }))
  const debtors = nets.filter((n) => n.net < -0.005).map((n) => ({ ...n, remaining: -n.net }))
  const transfers: { fromUserId: string; fromUserName: string | null; toUserId: string; toUserName: string | null; amount: number }[] = []

  let ci = 0
  let di = 0
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]
    const d = debtors[di]
    const amount = Math.min(c.remaining, d.remaining)
    if (amount > 0.005) {
      transfers.push({ fromUserId: d.userId, fromUserName: d.userName, toUserId: c.userId, toUserName: c.userName, amount })
    }
    c.remaining = Math.round((c.remaining - amount) * 100) / 100
    d.remaining = Math.round((d.remaining - amount) * 100) / 100
    if (c.remaining < 0.005) ci++
    if (d.remaining < 0.005) di++
  }

  return transfers
}

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

  const memberIds = members.map((m) => m.userId)
  const userNameMap = new Map(members.map((m) => [m.userId, m.userName]))

  const [expenses, settlements] = await Promise.all([
    db
      .select({ id: groupExpenses.id, paidByUserId: groupExpenses.paidByUserId, amount: groupExpenses.amount, currency: groupExpenses.currency })
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt))),
    db
      .select({ fromUserId: groupSettlements.fromUserId, toUserId: groupSettlements.toUserId, amount: groupSettlements.amount, currency: groupSettlements.currency })
      .from(groupSettlements)
      .where(and(eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt), eq(groupSettlements.status, 'completed'))),
  ])

  if (expenses.length === 0 && settlements.length === 0) return c.json([])

  const expenseIds = expenses.map((e) => e.id)

  const splits = expenseIds.length > 0
    ? await db
        .select({ expenseId: groupExpenseSplits.expenseId, userId: groupExpenseSplits.userId, amount: groupExpenseSplits.amount })
        .from(groupExpenseSplits)
        .where(inArray(groupExpenseSplits.expenseId, expenseIds))
    : []

  // Build per-currency net positions: net[currency][userId] = paid - owed
  const nets = new Map<string, Map<string, number>>()

  for (const e of expenses) {
    const curr = e.currency
    if (!nets.has(curr)) nets.set(curr, new Map())
    const currMap = nets.get(curr)!
    const paid = parseFloat(e.amount)
    currMap.set(e.paidByUserId, (currMap.get(e.paidByUserId) ?? 0) + paid)
  }

  for (const s of splits) {
    const exp = expenses.find((e) => e.id === s.expenseId)
    if (!exp) continue
    const curr = exp.currency
    const currMap = nets.get(curr)!
    const owed = parseFloat(s.amount)
    currMap.set(s.userId, (currMap.get(s.userId) ?? 0) - owed)
  }

  // Settlements: fromUser paid toUser → fromUser net += amount, toUser net -= amount
  for (const s of settlements) {
    const curr = s.currency
    if (!nets.has(curr)) nets.set(curr, new Map())
    const currMap = nets.get(curr)!
    const amt = parseFloat(s.amount)
    currMap.set(s.fromUserId, (currMap.get(s.fromUserId) ?? 0) + amt)
    currMap.set(s.toUserId, (currMap.get(s.toUserId) ?? 0) - amt)
  }

  // Build response per currency
  const result: CurrencyBalance[] = []

  for (const [currency, currMap] of nets) {
    const netList = memberIds.map((uid) => ({
      userId: uid,
      userName: userNameMap.get(uid) ?? null,
      net: Math.round((currMap.get(uid) ?? 0) * 100) / 100,
    }))

    const transfers = simplifyDebts(netList)

    result.push({
      currency,
      netPositions: netList.map((n) => ({ userId: n.userId, userName: n.userName, amount: n.net.toFixed(2) })),
      transfers: transfers.map((t) => ({
        fromUserId: t.fromUserId,
        fromUserName: t.fromUserName,
        toUserId: t.toUserId,
        toUserName: t.toUserName,
        amount: t.amount.toFixed(2),
        currency,
      })),
    })
  }

  return c.json(result)
})

export default app
