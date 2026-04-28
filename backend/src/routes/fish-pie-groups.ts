import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroups, expenseGroupMembers, user } from '../db/schema'
import { eq, isNull, and, inArray } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

async function fetchMembersForGroups(groupIds: string[]) {
  if (groupIds.length === 0) return []
  return db
    .select({
      id: expenseGroupMembers.id,
      groupId: expenseGroupMembers.groupId,
      userId: expenseGroupMembers.userId,
      shareWeight: expenseGroupMembers.shareWeight,
      joinedAt: expenseGroupMembers.joinedAt,
      userName: user.name,
      userEmail: user.email,
    })
    .from(expenseGroupMembers)
    .innerJoin(user, eq(expenseGroupMembers.userId, user.id))
    .where(inArray(expenseGroupMembers.groupId, groupIds))
}

app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)

  const group = await db.transaction(async (tx) => {
    const [g] = await tx
      .insert(expenseGroups)
      .values({ name: body.name!.trim(), createdBy: userId })
      .returning()
    await tx
      .insert(expenseGroupMembers)
      .values({ groupId: g.id, userId, shareWeight: 1 })
    return g
  })

  const members = await fetchMembersForGroups([group.id])
  return c.json({ ...group, members }, 201)
})

app.get('/', async (c) => {
  const userId = c.get('userId')

  const memberRows = await db
    .select({ groupId: expenseGroupMembers.groupId })
    .from(expenseGroupMembers)
    .innerJoin(expenseGroups, eq(expenseGroupMembers.groupId, expenseGroups.id))
    .where(and(eq(expenseGroupMembers.userId, userId), isNull(expenseGroups.deletedAt)))

  if (memberRows.length === 0) return c.json([])

  const groupIds = memberRows.map((r) => r.groupId)

  const groups = await db
    .select()
    .from(expenseGroups)
    .where(and(inArray(expenseGroups.id, groupIds), isNull(expenseGroups.deletedAt)))

  const members = await fetchMembersForGroups(groupIds)

  return c.json(groups.map((g) => ({
    ...g,
    members: members.filter((m) => m.groupId === g.id),
  })))
})

app.get('/:id', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))

  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await fetchMembersForGroups([groupId])
  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return c.json({ error: 'not found' }, 404)

  return c.json({ ...group, members })
})

app.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))

  if (!group) return c.json({ error: 'not found' }, 404)
  if (group.createdBy !== userId) return c.json({ error: 'forbidden' }, 403)

  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)

  const [updated] = await db
    .update(expenseGroups)
    .set({ name: body.name.trim() })
    .where(eq(expenseGroups.id, groupId))
    .returning()

  const members = await fetchMembersForGroups([groupId])
  return c.json({ ...updated, members })
})

app.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))

  if (!group) return c.json({ error: 'not found' }, 404)
  if (group.createdBy !== userId) return c.json({ error: 'forbidden' }, 403)

  await db
    .update(expenseGroups)
    .set({ deletedAt: new Date() })
    .where(eq(expenseGroups.id, groupId))

  return new Response(null, { status: 204 })
})

export default app
