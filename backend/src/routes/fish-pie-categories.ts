import { Hono } from 'hono'
import { db } from '../db'
import {
  expenseGroups,
  expenseGroupMembers,
  groupCategories,
  groupCategoryMemberAccounts,
  groupCategoryWeights,
  accounts,
} from '../db/schema'
import { eq, and, isNull, inArray, asc } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// Shape returned for each category: the shared category fields, the requesting user's
// own (private) account mapping, and the category's shared weight vector — one entry
// per member who has an agreed weight. An empty `weights` means the split falls back
// to group member weights.
export type CategoryPayload = {
  id: string
  groupId: string
  name: string
  sortOrder: number
  archivedAt: Date | null
  myMapping: { accountId: string } | null
  weights: { userId: string; weight: number }[]
}

// Load all categories for the given groups, each annotated with `userId`'s own
// account mapping and the category's shared weight vector. Sorted by sortOrder then
// name for a stable display order. Used here and by the groups route to embed
// categories in the group GET payloads.
export async function fetchCategoriesForGroups(
  groupIds: string[],
  userId: string,
): Promise<(CategoryPayload & { groupId: string })[]> {
  if (groupIds.length === 0) return []

  const cats = await db
    .select()
    .from(groupCategories)
    .where(inArray(groupCategories.groupId, groupIds))
    .orderBy(asc(groupCategories.sortOrder), asc(groupCategories.name))

  if (cats.length === 0) return []

  const categoryIds = cats.map((c) => c.id)
  const [mappings, weights] = await Promise.all([
    // Only the requesting user's account mapping (private)
    db
      .select()
      .from(groupCategoryMemberAccounts)
      .where(and(inArray(groupCategoryMemberAccounts.categoryId, categoryIds), eq(groupCategoryMemberAccounts.userId, userId))),
    // The full shared weight vector for each category
    db.select().from(groupCategoryWeights).where(inArray(groupCategoryWeights.categoryId, categoryIds)),
  ])

  const mappingByCategory = new Map(mappings.map((m) => [m.categoryId, m]))
  const weightsByCategory = new Map<string, { userId: string; weight: number }[]>()
  for (const w of weights) {
    const list = weightsByCategory.get(w.categoryId) ?? []
    list.push({ userId: w.userId, weight: w.weight })
    weightsByCategory.set(w.categoryId, list)
  }

  return cats.map((c) => {
    const m = mappingByCategory.get(c.id)
    return {
      id: c.id,
      groupId: c.groupId,
      name: c.name,
      sortOrder: c.sortOrder,
      archivedAt: c.archivedAt,
      myMapping: m ? { accountId: m.accountId } : null,
      weights: weightsByCategory.get(c.id) ?? [],
    }
  })
}

// Resolve the group and assert the requesting user is a member. Returns the group on
// success, or a Hono JSON 404 response (groups are hidden from non-members) on failure.
async function requireMembership(groupId: string, userId: string) {
  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))

  if (!group) return { error: 'not found' as const }

  const [membership] = await db
    .select({ id: expenseGroupMembers.id })
    .from(expenseGroupMembers)
    .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, userId)))

  if (!membership) return { error: 'not found' as const }
  return { group }
}

app.get('/:groupId/categories', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const access = await requireMembership(groupId, userId)
  if ('error' in access) return c.json({ error: access.error }, 404)

  const categories = await fetchCategoriesForGroups([groupId], userId)
  return c.json(categories)
})

app.post('/:groupId/categories', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const access = await requireMembership(groupId, userId)
  if ('error' in access) return c.json({ error: access.error }, 404)

  const body = await c.req.json<{ name?: string; sortOrder?: number }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (body.sortOrder !== undefined && !Number.isInteger(body.sortOrder)) {
    return c.json({ error: 'sortOrder must be an integer' }, 400)
  }

  // Default sortOrder to the end of the existing list when not specified.
  let sortOrder = body.sortOrder
  if (sortOrder === undefined) {
    const existing = await db
      .select({ sortOrder: groupCategories.sortOrder })
      .from(groupCategories)
      .where(eq(groupCategories.groupId, groupId))
    sortOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder + 1), 0)
  }

  const [created] = await db
    .insert(groupCategories)
    .values({ groupId, name: body.name.trim(), sortOrder })
    .returning()

  return c.json({
    id: created.id,
    groupId: created.groupId,
    name: created.name,
    sortOrder: created.sortOrder,
    archivedAt: created.archivedAt,
    myMapping: null,
    weights: [],
  }, 201)
})

app.patch('/:groupId/categories/:id', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const categoryId = c.req.param('id')

  const access = await requireMembership(groupId, userId)
  if ('error' in access) return c.json({ error: access.error }, 404)

  const [category] = await db
    .select()
    .from(groupCategories)
    .where(and(eq(groupCategories.id, categoryId), eq(groupCategories.groupId, groupId)))
  if (!category) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{ name?: string; sortOrder?: number; archived?: boolean }>()
  if (body.name !== undefined && !body.name.trim()) {
    return c.json({ error: 'name cannot be empty' }, 400)
  }
  if (body.sortOrder !== undefined && !Number.isInteger(body.sortOrder)) {
    return c.json({ error: 'sortOrder must be an integer' }, 400)
  }

  const updates: Partial<typeof groupCategories.$inferInsert> = {}
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder
  if (body.archived !== undefined) updates.archivedAt = body.archived ? new Date() : null

  if (Object.keys(updates).length === 0) return c.json({ error: 'no fields to update' }, 400)

  await db.update(groupCategories).set(updates).where(eq(groupCategories.id, categoryId))

  const all = await fetchCategoriesForGroups([groupId], userId)
  return c.json(all.find((cat) => cat.id === categoryId))
})

// PUT /:groupId/categories/:id/my-mapping — upsert the requesting user's own account
// mapping (private). Each member manages only their own; you cannot set another
// member's account. Split weights are separate and shared — see the weights endpoint.
app.put('/:groupId/categories/:id/my-mapping', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const categoryId = c.req.param('id')

  const access = await requireMembership(groupId, userId)
  if ('error' in access) return c.json({ error: access.error }, 404)

  const [category] = await db
    .select({ id: groupCategories.id })
    .from(groupCategories)
    .where(and(eq(groupCategories.id, categoryId), eq(groupCategories.groupId, groupId)))
  if (!category) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{ accountId?: string }>()
  if (!body.accountId) return c.json({ error: 'accountId is required' }, 400)

  // The account must belong to the requesting user (members post into their own trees).
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, body.accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!acct) return c.json({ error: 'account not found or does not belong to you' }, 400)

  const [mapping] = await db
    .insert(groupCategoryMemberAccounts)
    .values({ categoryId, userId, accountId: body.accountId })
    .onConflictDoUpdate({
      target: [groupCategoryMemberAccounts.categoryId, groupCategoryMemberAccounts.userId],
      set: { accountId: body.accountId },
    })
    .returning()

  return c.json({ categoryId, accountId: mapping.accountId })
})

// PUT /:groupId/categories/:id/weights — set the category's shared split weights.
// Any member may set the whole vector (the group agreement is implied). The body
// replaces the category's weights wholesale: members omitted are cleared, so the
// category either has a complete vector (every current member) or partial/none, and
// the split logic only honours complete vectors.
app.put('/:groupId/categories/:id/weights', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const categoryId = c.req.param('id')

  const access = await requireMembership(groupId, userId)
  if ('error' in access) return c.json({ error: access.error }, 404)

  const [category] = await db
    .select({ id: groupCategories.id })
    .from(groupCategories)
    .where(and(eq(groupCategories.id, categoryId), eq(groupCategories.groupId, groupId)))
  if (!category) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{ weights?: { userId: string; weight: number }[] }>()
  if (!Array.isArray(body.weights)) return c.json({ error: 'weights array is required' }, 400)

  // Every entry must be a current group member with a positive integer weight, no dupes.
  const memberRows = await db
    .select({ userId: expenseGroupMembers.userId })
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))
  const memberIds = new Set(memberRows.map((m) => m.userId))

  const seen = new Set<string>()
  for (const w of body.weights) {
    if (typeof w.userId !== 'string' || !memberIds.has(w.userId)) {
      return c.json({ error: `weights: ${w.userId} is not a group member` }, 400)
    }
    if (seen.has(w.userId)) return c.json({ error: `weights: duplicate entry for ${w.userId}` }, 400)
    seen.add(w.userId)
    if (!Number.isInteger(w.weight) || w.weight < 1) {
      return c.json({ error: 'weights: weight must be a positive integer' }, 400)
    }
  }

  // Replace the whole vector atomically.
  await db.transaction(async (tx) => {
    await tx.delete(groupCategoryWeights).where(eq(groupCategoryWeights.categoryId, categoryId))
    if (body.weights!.length > 0) {
      await tx.insert(groupCategoryWeights).values(
        body.weights!.map((w) => ({ categoryId, userId: w.userId, weight: w.weight })),
      )
    }
  })

  const all = await fetchCategoriesForGroups([groupId], userId)
  return c.json(all.find((cat) => cat.id === categoryId))
})

export default app
