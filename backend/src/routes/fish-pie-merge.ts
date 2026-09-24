import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import {
  accounts,
  expenseGroupMembers,
  expenseGroups,
  groupCategories,
  groupCategoryMemberAccounts,
  groupCategoryWeights,
  groupExpenses,
  groupSettlements,
  postings,
} from '../db/schema'
import { fail } from '../errors'
import { CLEARING_PREFIX, ensureSharedAccount, slugify } from '../fish-pie-accounts'
import { fetchCategoriesForGroups } from './fish-pie-categories'
import { fetchMembersForGroups } from './fish-pie-groups'

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

  if (!body.name?.trim()) return fail(c, 'FIELD_REQUIRED', { field: 'name' })
  const name = body.name.trim()
  if (!Array.isArray(body.groupIds)) return fail(c, 'FIELD_REQUIRED', { field: 'groupIds' })

  // Preserve request order (first group is the weight/defaults fallback) but de-dupe.
  const groupIds = [...new Set(body.groupIds)]
  // The first group is the weight/defaults fallback, so the merge needs it to exist —
  // which `< 2` already guarantees, said in a way the compiler can follow.
  const firstGroupId = groupIds[0]
  if (groupIds.length < 2 || firstGroupId === undefined) return fail(c, 'MERGE_NEEDS_TWO_GROUPS')

  const sourceGroups = await db
    .select()
    .from(expenseGroups)
    .where(and(inArray(expenseGroups.id, groupIds), isNull(expenseGroups.deletedAt)))
  if (sourceGroups.length !== groupIds.length) return fail(c, 'GROUPS_NOT_FOUND')
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
    if (!list.some((m) => m.userId === userId)) return fail(c, 'NOT_A_MEMBER_OF_ALL_GROUPS')
  }

  // Identical, non-empty member sets across all groups.
  const memberSetKey = (gid: string) =>
    (membersByGroup.get(gid) ?? [])
      .map((m) => m.userId)
      .sort()
      .join(',')
  const keys = new Set(groupIds.map(memberSetKey))
  if (keys.size !== 1) return fail(c, 'MERGE_MEMBERS_DIFFER')

  const firstGroupMembers = membersByGroup.get(firstGroupId) ?? []
  if (firstGroupMembers.length === 0) return fail(c, 'MERGE_GROUPS_EMPTY')
  const memberUserIds = firstGroupMembers.map((m) => m.userId)

  const newGroup = await db.transaction(async (tx) => {
    // 1. Create the target group with the (identical) union member set. Member
    //    shareWeight + account defaults come from the first group as a *fallback* —
    //    the real per-category weights/accounts live on the categories below.
    const firstGroup = sourceGroupById.get(firstGroupId)!
    const created = returnedRow(
      await tx
        .insert(expenseGroups)
        .values({
          name,
          createdBy: userId,
          defaultCurrency: firstGroup.defaultCurrency ?? null,
        })
        .returning(),
      'insert expenseGroups',
    )

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
      const cat = returnedRow(
        await tx
          .insert(groupCategories)
          .values({ groupId: created.id, name: srcGroup.name, sortOrder: sortOrder++ })
          .returning(),
        'insert groupCategories',
      )
      categoryByGroup.set(gid, cat.id)

      const mappingRows = srcMembers
        .filter((m) => m.defaultExpenseAccountId)
        .map((m) => ({
          categoryId: cat.id,
          userId: m.userId,
          accountId: m.defaultExpenseAccountId!,
        }))
      if (mappingRows.length > 0) await tx.insert(groupCategoryMemberAccounts).values(mappingRows)

      await tx
        .insert(groupCategoryWeights)
        .values(
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
    await tx
      .update(groupSettlements)
      .set({ groupId: created.id })
      .where(inArray(groupSettlements.groupId, groupIds))

    // 6. Collapse old per-source-group clearing accounts into each member's single new
    //    clearing account, then soft-delete the old accounts.
    const oldClearingPaths = groupIds.map(
      (gid) => `${CLEARING_PREFIX}:${slugify(sourceGroupById.get(gid)!.name)}`,
    )
    const newClearingIds = new Set(newClearingByUser.values())
    const oldClearingAccounts = await tx
      .select({ id: accounts.id, userId: accounts.userId })
      .from(accounts)
      .where(
        and(
          inArray(accounts.userId, memberUserIds),
          inArray(accounts.path, oldClearingPaths),
          isNull(accounts.deletedAt),
        ),
      )

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
    await tx
      .update(expenseGroups)
      .set({ deletedAt: new Date() })
      .where(inArray(expenseGroups.id, groupIds))

    return created
  })

  const members = await fetchMembersForGroups([newGroup.id])
  const categories = await fetchCategoriesForGroups([newGroup.id], userId)
  return c.json({ ...newGroup, members, categories }, 201)
})

export default app
