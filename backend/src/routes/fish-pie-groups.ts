import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroups, expenseGroupMembers, accounts, user } from '../db/schema'
import { eq, isNull, and, inArray } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { ensureSharedAccount } from '../fish-pie-accounts'
import { fetchCategoriesForGroups } from './fish-pie-categories'

const app = new Hono<{ Variables: AppVariables }>()

async function fetchMembersForGroups(groupIds: string[]) {
  if (groupIds.length === 0) return []
  return db
    .select({
      id: expenseGroupMembers.id,
      groupId: expenseGroupMembers.groupId,
      userId: expenseGroupMembers.userId,
      shareWeight: expenseGroupMembers.shareWeight,
      defaultExpenseAccountId: expenseGroupMembers.defaultExpenseAccountId,
      defaultPaymentAccountId: expenseGroupMembers.defaultPaymentAccountId,
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
    await ensureSharedAccount(userId, g, tx)
    return g
  })

  const members = await fetchMembersForGroups([group.id])
  return c.json({ ...group, members, categories: [] }, 201)
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
  const categories = await fetchCategoriesForGroups(groupIds, userId)

  return c.json(groups.map((g) => ({
    ...g,
    members: members.filter((m) => m.groupId === g.id),
    categories: categories.filter((cat) => cat.groupId === g.id),
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

  const categories = await fetchCategoriesForGroups([groupId], userId)
  return c.json({ ...group, members, categories })
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

  const body = await c.req.json<{ name?: string; defaultCurrency?: string | null }>()
  if (body.name !== undefined && !body.name.trim()) return c.json({ error: 'name cannot be empty' }, 400)

  const updates: Partial<typeof expenseGroups.$inferInsert> = {}
  if (body.name !== undefined) updates.name = body.name.trim()
  if ('defaultCurrency' in body) updates.defaultCurrency = body.defaultCurrency ?? null

  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  const [updated] = await db
    .update(expenseGroups)
    .set(updates)
    .where(eq(expenseGroups.id, groupId))
    .returning()

  const members = await fetchMembersForGroups([groupId])
  const categories = await fetchCategoriesForGroups([groupId], userId)
  return c.json({ ...updated, members, categories })
})

// PATCH /api/fish-pie/groups/:id/members/me — update own member settings (expense/payment account)
app.patch('/:id/members/me', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')

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

  const body = await c.req.json<{
    defaultExpenseAccountId?: string | null
    defaultPaymentAccountId?: string | null
  }>()

  const hasExpense = 'defaultExpenseAccountId' in body
  const hasPayment = 'defaultPaymentAccountId' in body
  if (!hasExpense && !hasPayment) return c.json({ error: 'no fields to update' }, 400)

  async function validateAccount(id: string | null | undefined) {
    if (id == null) return null
    const [acct] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    if (!acct) return 'invalid'
    return id
  }

  const expenseAccountId = hasExpense ? await validateAccount(body.defaultExpenseAccountId) : undefined
  if (expenseAccountId === 'invalid') return c.json({ error: 'account not found or does not belong to you' }, 400)

  const paymentAccountId = hasPayment ? await validateAccount(body.defaultPaymentAccountId) : undefined
  if (paymentAccountId === 'invalid') return c.json({ error: 'account not found or does not belong to you' }, 400)

  const patch: Partial<typeof expenseGroupMembers.$inferInsert> = {}
  if (expenseAccountId !== undefined) patch.defaultExpenseAccountId = expenseAccountId
  if (paymentAccountId !== undefined) patch.defaultPaymentAccountId = paymentAccountId

  const [updated] = await db
    .update(expenseGroupMembers)
    .set(patch)
    .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, userId)))
    .returning()

  return c.json(updated)
})

app.patch('/:id/members/:userId', async (c) => {
  const requestingUserId = c.get('userId')
  const groupId = c.req.param('id')
  const targetUserId = c.req.param('userId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))

  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await fetchMembersForGroups([groupId])
  if (!members.some((m) => m.userId === requestingUserId)) return c.json({ error: 'not found' }, 404)

  // Any group member may adjust share weights (not just self or creator)

  const body = await c.req.json<{ shareWeight?: number }>()
  const weight = body.shareWeight
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1) {
    return c.json({ error: 'shareWeight must be a positive integer' }, 400)
  }

  const [updated] = await db
    .update(expenseGroupMembers)
    .set({ shareWeight: weight })
    .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, targetUserId)))
    .returning()

  if (!updated) return c.json({ error: 'member not found' }, 404)
  return c.json(updated)
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
