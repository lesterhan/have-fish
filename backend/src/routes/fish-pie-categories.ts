import { Hono } from 'hono'
import { db } from '../db'
import {
  expenseGroups,
  expenseGroupMembers,
  groupCategories,
  groupCategoryMemberAccounts,
  accounts,
} from '../db/schema'
import { eq, and, isNull, inArray, asc } from 'drizzle-orm'
import type { AppVariables } from '../app'

const app = new Hono<{ Variables: AppVariables }>()

// Shape returned for each category: the shared category fields plus the requesting
// user's own mapping (account + per-category weight), or null when they haven't mapped it.
export type CategoryPayload = {
  id: string
  groupId: string
  name: string
  sortOrder: number
  archivedAt: Date | null
  myMapping: { accountId: string; shareWeight: number | null } | null
}

// Load all categories for the given groups, each annotated with `userId`'s own mapping.
// Sorted by sortOrder then name for a stable display order. Used here and by the
// groups route to embed categories in the group GET payloads.
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

  const mappings = await db
    .select()
    .from(groupCategoryMemberAccounts)
    .where(
      and(
        inArray(groupCategoryMemberAccounts.categoryId, cats.map((c) => c.id)),
        eq(groupCategoryMemberAccounts.userId, userId),
      ),
    )

  const mappingByCategory = new Map(mappings.map((m) => [m.categoryId, m]))

  return cats.map((c) => {
    const m = mappingByCategory.get(c.id)
    return {
      id: c.id,
      groupId: c.groupId,
      name: c.name,
      sortOrder: c.sortOrder,
      archivedAt: c.archivedAt,
      myMapping: m ? { accountId: m.accountId, shareWeight: m.shareWeight } : null,
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

  const [updated] = await db
    .update(groupCategories)
    .set(updates)
    .where(eq(groupCategories.id, categoryId))
    .returning()

  const [mapping] = await db
    .select()
    .from(groupCategoryMemberAccounts)
    .where(
      and(
        eq(groupCategoryMemberAccounts.categoryId, categoryId),
        eq(groupCategoryMemberAccounts.userId, userId),
      ),
    )

  return c.json({
    id: updated.id,
    groupId: updated.groupId,
    name: updated.name,
    sortOrder: updated.sortOrder,
    archivedAt: updated.archivedAt,
    myMapping: mapping ? { accountId: mapping.accountId, shareWeight: mapping.shareWeight } : null,
  })
})

// PUT /:groupId/categories/:id/my-mapping — upsert the requesting user's own mapping.
// Each member manages only their own mapping; you cannot set another member's account.
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

  const body = await c.req.json<{ accountId?: string; shareWeight?: number | null }>()
  if (!body.accountId) return c.json({ error: 'accountId is required' }, 400)

  if (
    body.shareWeight !== undefined &&
    body.shareWeight !== null &&
    (!Number.isInteger(body.shareWeight) || body.shareWeight < 1)
  ) {
    return c.json({ error: 'shareWeight must be a positive integer' }, 400)
  }

  // The account must belong to the requesting user (members post into their own trees).
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, body.accountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!acct) return c.json({ error: 'account not found or does not belong to you' }, 400)

  const shareWeight = body.shareWeight ?? null

  const [mapping] = await db
    .insert(groupCategoryMemberAccounts)
    .values({ categoryId, userId, accountId: body.accountId, shareWeight })
    .onConflictDoUpdate({
      target: [groupCategoryMemberAccounts.categoryId, groupCategoryMemberAccounts.userId],
      set: { accountId: body.accountId, shareWeight },
    })
    .returning()

  return c.json({ categoryId, accountId: mapping.accountId, shareWeight: mapping.shareWeight })
})

export default app
