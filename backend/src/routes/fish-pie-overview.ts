import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroups, expenseGroupInvites } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { fetchMembersForGroups } from './fish-pie-groups'
import { fetchCategoriesForGroups } from './fish-pie-categories'
import { fetchGroupExpenses } from './fish-pie-expenses'
import { fetchGroupSettlements } from './fish-pie-settlements'
import { computeCurrencyBalances } from '../fish-pie-balance-service'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/fish-pie/groups/:id/overview
// Everything the group page needs in one round-trip: the group (+members
// +categories), its expenses, settlements, pending invites, and balances.
// Balances are computed from the same expense/settlement data fetched for the
// lists, so those queries run once instead of being repeated by the separate
// /expenses, /balances and /settlements endpoints.
app.get('/:id/overview', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await fetchMembersForGroups([groupId])
  if (!members.some((m) => m.userId === userId)) return c.json({ error: 'not found' }, 404)

  const [categories, expenses, settlements, invites] = await Promise.all([
    fetchCategoriesForGroups([groupId], userId),
    fetchGroupExpenses(groupId),
    fetchGroupSettlements(groupId),
    db
      .select()
      .from(expenseGroupInvites)
      .where(and(eq(expenseGroupInvites.groupId, groupId), eq(expenseGroupInvites.status, 'pending'))),
  ])

  const memberLite = members.map((m) => ({ userId: m.userId, userName: m.userName }))
  const completed = settlements.filter((s) => s.status === 'completed')
  const balances = computeCurrencyBalances(memberLite, expenses, completed)

  return c.json({
    group: { ...group, members, categories },
    expenses,
    settlements,
    invites,
    balances,
  })
})

export default app
