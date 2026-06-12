import { Hono } from 'hono'
import { db } from '../db'
import {
  expenseGroups,
  expenseGroupMembers,
  groupExpenses,
  groupSettlements,
  groupCategories,
  groupCategoryMemberAccounts,
  groupCategoryWeights,
  accounts,
  postings,
  user,
} from '../db/schema'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { ensureSharedAccount, slugify, CLEARING_PREFIX } from '../fish-pie-accounts'
import { fetchCategoriesForGroups } from './fish-pie-categories'

const app = new Hono<{ Variables: AppVariables }>()

// POST /api/fish-pie/groups/merge
// Convert several category-as-group groups into one group with a category per source
// group. Balances net automatically afterwards because they're derived from expenses
// + splits + settlements, all of which get re-pointed onto the merged group.
//
// Body: { groupIds: string[]  (>= 2, identical member sets, caller is a member of all),
//         name: string        (the merged group's name) }
app.post('/merge', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ groupIds?: string[]; name?: string }>()

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (!Array.isArray(body.groupIds)) return c.json({ error: 'groupIds is required' }, 400)

  // Preserve request order (first group is the weight/defaults fallback) but de-dupe.
  const groupIds = [...new Set(body.groupIds)]
  if (groupIds.length < 2) return c.json({ error: 'at least two distinct groups are required' }, 400)

  const sourceGroups = await db
    .select()
    .from(expenseGroups)
    .where(and(inArray(expenseGroups.id, groupIds), isNull(expenseGroups.deletedAt)))
  if (sourceGroups.length !== groupIds.length) return c.json({ error: 'one or more groups not found' }, 404)
  const sourceGroupById = new Map(sourceGroups.map((g) => [g.id, g]))

  const allMembers = await db
    .select()
    .from(expenseGroupMembers)
    .where(inArray(expenseGroupMembers.groupId, groupIds))

  const membersByGroup = new Map<string, typeof allMembers>()
  for (const m of allMembers) {
    const list = membersByGroup.get(m.groupId) ?? []
    list.push(m)
    membersByGroup.set(m.groupId, list)
  }

  // Caller must be a member of every group.
  for (const gid of groupIds) {
    const list = membersByGroup.get(gid) ?? []
    if (!list.some((m) => m.userId === userId)) return c.json({ error: 'not a member of all groups' }, 403)
  }

  // Identical, non-empty member sets across all groups.
  const memberSetKey = (gid: string) => (membersByGroup.get(gid) ?? []).map((m) => m.userId).sort().join(',')
  const keys = new Set(groupIds.map(memberSetKey))
  if (keys.size !== 1) return c.json({ error: 'groups must have identical member sets' }, 400)

  const firstGroupId = groupIds[0]
  const firstGroupMembers = membersByGroup.get(firstGroupId) ?? []
  if (firstGroupMembers.length === 0) return c.json({ error: 'groups have no members' }, 400)
  const memberUserIds = firstGroupMembers.map((m) => m.userId)

  const newGroup = await db.transaction(async (tx) => {
    // 1. Create the target group with the (identical) union member set. Member
    //    shareWeight + account defaults come from the first group as a *fallback* —
    //    the real per-category weights/accounts live on the categories below.
    const firstGroup = sourceGroupById.get(firstGroupId)!
    const [created] = await tx
      .insert(expenseGroups)
      .values({ name: body.name!.trim(), createdBy: userId, defaultCurrency: firstGroup.defaultCurrency ?? null })
      .returning()

    const firstMemberByUser = new Map(firstGroupMembers.map((m) => [m.userId, m]))
    await tx.insert(expenseGroupMembers).values(
      memberUserIds.map((uid) => {
        const fm = firstMemberByUser.get(uid)!
        return {
          groupId: created.id,
          userId: uid,
          shareWeight: fm.shareWeight,
          defaultExpenseAccountId: fm.defaultExpenseAccountId,
          defaultPaymentAccountId: fm.defaultPaymentAccountId,
        }
      }),
    )

    // 2. One clearing (receivable) account per member for the merged group.
    const newClearingByUser = new Map<string, string>()
    for (const uid of memberUserIds) {
      newClearingByUser.set(uid, await ensureSharedAccount(uid, created, tx))
    }

    // 3. One category per source group, carrying each member's account mapping (from
    //    their source-group default) and the agreed weight (their source-group
    //    shareWeight). Every member gets a weight, so the vector is complete.
    const categoryByGroup = new Map<string, string>()
    let sortOrder = 0
    for (const gid of groupIds) {
      const srcGroup = sourceGroupById.get(gid)!
      const srcMembers = membersByGroup.get(gid)!
      const [cat] = await tx
        .insert(groupCategories)
        .values({ groupId: created.id, name: srcGroup.name, sortOrder: sortOrder++ })
        .returning()
      categoryByGroup.set(gid, cat.id)

      const mappingRows = srcMembers
        .filter((m) => m.defaultExpenseAccountId)
        .map((m) => ({ categoryId: cat.id, userId: m.userId, accountId: m.defaultExpenseAccountId! }))
      if (mappingRows.length > 0) await tx.insert(groupCategoryMemberAccounts).values(mappingRows)

      await tx.insert(groupCategoryWeights).values(
        srcMembers.map((m) => ({ categoryId: cat.id, userId: m.userId, weight: m.shareWeight })),
      )
    }

    // 4. Re-point each source group's expenses onto the merged group + its category.
    for (const gid of groupIds) {
      await tx
        .update(groupExpenses)
        .set({ groupId: created.id, categoryId: categoryByGroup.get(gid)! })
        .where(eq(groupExpenses.groupId, gid))
    }

    // 5. Re-point settlements onto the merged group.
    await tx.update(groupSettlements).set({ groupId: created.id }).where(inArray(groupSettlements.groupId, groupIds))

    // 6. Collapse old per-source-group clearing accounts into each member's single new
    //    clearing account, then soft-delete the old accounts. Matches both the legacy
    //    `group:<slug>` and the current `assets:receivable:<slug>` paths so data created
    //    either side of the scheme flip is captured.
    const oldClearingPaths: string[] = []
    for (const gid of groupIds) {
      const srcSlug = slugify(sourceGroupById.get(gid)!.name)
      oldClearingPaths.push(`group:${srcSlug}`, `${CLEARING_PREFIX}:${srcSlug}`)
    }
    const newClearingIds = new Set(newClearingByUser.values())
    const oldClearingAccounts = await tx
      .select({ id: accounts.id, userId: accounts.userId })
      .from(accounts)
      .where(and(inArray(accounts.userId, memberUserIds), inArray(accounts.path, oldClearingPaths), isNull(accounts.deletedAt)))

    const toDelete: string[] = []
    for (const acct of oldClearingAccounts) {
      // Slug collision: the merged group's account is itself one of the matched paths.
      // Leave it alone — re-pointing onto itself then deleting it would wipe the merge.
      if (newClearingIds.has(acct.id)) continue
      const newId = newClearingByUser.get(acct.userId)
      if (!newId) continue
      await tx.update(postings).set({ accountId: newId }).where(eq(postings.accountId, acct.id))
      toDelete.push(acct.id)
    }
    if (toDelete.length > 0) {
      await tx.update(accounts).set({ deletedAt: new Date() }).where(inArray(accounts.id, toDelete))
    }

    // 7. Soft-delete the source groups.
    await tx.update(expenseGroups).set({ deletedAt: new Date() }).where(inArray(expenseGroups.id, groupIds))

    return created
  })

  const members = await db
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
    .where(eq(expenseGroupMembers.groupId, newGroup.id))

  const categories = await fetchCategoriesForGroups([newGroup.id], userId)
  return c.json({ ...newGroup, members, categories }, 201)
})

export default app
