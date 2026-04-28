import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroups, expenseGroupMembers, groupSettlements, user } from '../db/schema'
import { eq, isNull, and, inArray, desc } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

async function fetchSettlementsWithNames(settlementIds: string[]) {
  if (settlementIds.length === 0) return []

  const settlements = await db
    .select()
    .from(groupSettlements)
    .where(inArray(groupSettlements.id, settlementIds))

  const userIds = [...new Set([...settlements.map((s) => s.fromUserId), ...settlements.map((s) => s.toUserId)])]
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))
  const nameMap = new Map(users.map((u) => [u.id, u.name]))

  return settlements.map((s) => ({
    ...s,
    fromUserName: nameMap.get(s.fromUserId) ?? null,
    toUserName: nameMap.get(s.toUserId) ?? null,
  }))
}

// POST /api/fish-pie/groups/:groupId/settlements
app.post('/groups/:groupId/settlements', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await db
    .select({ userId: expenseGroupMembers.userId })
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  const memberIds = new Set(members.map((m) => m.userId))
  if (!memberIds.has(userId)) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{
    fromUserId?: string
    toUserId?: string
    amount?: string
    currency?: string
    date?: string
    note?: string
  }>()

  if (!body.fromUserId || !memberIds.has(body.fromUserId)) return c.json({ error: 'fromUserId must be a group member' }, 400)
  if (!body.toUserId || !memberIds.has(body.toUserId)) return c.json({ error: 'toUserId must be a group member' }, 400)
  if (body.fromUserId === body.toUserId) return c.json({ error: 'from and to must differ' }, 400)
  if (!body.amount || isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0)
    return c.json({ error: 'amount must be a positive number' }, 400)
  if (!body.currency?.trim()) return c.json({ error: 'currency is required' }, 400)
  if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)

  const [settlement] = await db
    .insert(groupSettlements)
    .values({
      groupId,
      fromUserId: body.fromUserId,
      toUserId: body.toUserId,
      amount: parseFloat(body.amount).toFixed(2),
      currency: body.currency.trim().toUpperCase(),
      date: body.date,
      note: body.note?.trim() || null,
    })
    .returning()

  const [withNames] = await fetchSettlementsWithNames([settlement.id])
  return c.json(withNames, 201)
})

// GET /api/fish-pie/groups/:groupId/settlements
app.get('/groups/:groupId/settlements', async (c) => {
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

  const settlements = await db
    .select()
    .from(groupSettlements)
    .where(and(eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt)))
    .orderBy(desc(groupSettlements.date), desc(groupSettlements.createdAt))

  if (settlements.length === 0) return c.json([])
  return c.json(await fetchSettlementsWithNames(settlements.map((s) => s.id)))
})

// DELETE /api/fish-pie/groups/:groupId/settlements/:settlementId
app.delete('/groups/:groupId/settlements/:settlementId', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const settlementId = c.req.param('settlementId')

  const [settlement] = await db
    .select()
    .from(groupSettlements)
    .where(and(eq(groupSettlements.id, settlementId), eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt)))
  if (!settlement) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, groupId))
  if (!group) return c.json({ error: 'not found' }, 404)

  const isParty = settlement.fromUserId === userId || settlement.toUserId === userId
  const isCreator = group.createdBy === userId
  if (!isParty && !isCreator) return c.json({ error: 'forbidden' }, 403)

  await db.update(groupSettlements).set({ deletedAt: new Date() }).where(eq(groupSettlements.id, settlementId))
  return new Response(null, { status: 204 })
})

export default app
