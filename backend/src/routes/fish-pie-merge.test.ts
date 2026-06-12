import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { expenseGroups, groupExpenses, groupSettlements, accounts, postings } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'

async function getUserId(cookie: string): Promise<string> {
  const res = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
  return ((await res.json()) as any).user.id
}

async function createGroup(cookie: string, name: string): Promise<string> {
  const res = await app.request('/api/fish-pie/groups', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as any).id
}

async function createAccount(cookie: string, path: string): Promise<string> {
  const res = await app.request('/api/accounts', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name: path }),
  })
  return ((await res.json()) as any).id
}

async function inviteAndAccept(groupId: string, ownerCookie: string, email: string, memberCookie: string) {
  const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
    method: 'POST',
    headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const inviteId = ((await invRes.json()) as any).id
  await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
    method: 'POST',
    headers: { Cookie: memberCookie },
  })
}

function setWeight(groupId: string, cookie: string, targetUserId: string, shareWeight: number) {
  return app.request(`/api/fish-pie/groups/${groupId}/members/${targetUserId}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareWeight }),
  })
}

function setMyExpenseAccount(groupId: string, cookie: string, accountId: string) {
  return app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultExpenseAccountId: accountId }),
  })
}

function createExpense(groupId: string, cookie: string, body: Record<string, unknown>) {
  return app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function merge(cookie: string, body: Record<string, unknown>) {
  return app.request('/api/fish-pie/groups/merge', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function balances(groupId: string, cookie: string) {
  const res = await app.request(`/api/fish-pie/groups/${groupId}/balances`, { headers: { Cookie: cookie } })
  return (await res.json()) as any[]
}

describe('fish-pie merge', () => {
  let cookieA: string
  let cookieB: string
  let userAId: string
  let userBId: string
  let payA: string

  beforeEach(async () => {
    await clearDatabase()
    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')
    userAId = await getUserId(cookieA)
    userBId = await getUserId(cookieB)
    payA = await createAccount(cookieA, 'liabilities:visa')
  })

  // Build two groups (Housing 60/40, Food 70/30), both with members A+B, each with one
  // expense paid by A. Returns ids needed by the merge assertions.
  async function twoGroupsWithExpenses() {
    const housing = await createGroup(cookieA, 'Housing')
    await inviteAndAccept(housing, cookieA, 'b@test.com', cookieB)
    await setWeight(housing, cookieA, userAId, 60)
    await setWeight(housing, cookieA, userBId, 40)
    const housingAcct = await createAccount(cookieA, 'expenses:housing')
    await setMyExpenseAccount(housing, cookieA, housingAcct)
    await createExpense(housing, cookieA, { description: 'Rent', amount: '100.00', currency: 'CAD', date: '2026-05-01', paymentAccountId: payA })

    const food = await createGroup(cookieA, 'Food')
    await inviteAndAccept(food, cookieA, 'b@test.com', cookieB)
    await setWeight(food, cookieA, userAId, 70)
    await setWeight(food, cookieA, userBId, 30)
    const foodAcct = await createAccount(cookieA, 'expenses:food')
    await setMyExpenseAccount(food, cookieA, foodAcct)
    await createExpense(food, cookieA, { description: 'Groceries', amount: '100.00', currency: 'CAD', date: '2026-05-02', paymentAccountId: payA })

    return { housing, food, housingAcct, foodAcct }
  }

  describe('happy path', () => {
    it('creates a merged group with a category per source group + preserved weights', async () => {
      const { housing, food, housingAcct, foodAcct } = await twoGroupsWithExpenses()

      const res = await merge(cookieA, { groupIds: [housing, food], name: 'Household' })
      expect(res.status).toBe(201)
      const merged = (await res.json()) as any
      expect(merged.name).toBe('Household')
      expect(merged.members).toHaveLength(2)

      const cats = merged.categories
      expect(cats.map((c: any) => c.name).sort()).toEqual(['Food', 'Housing'])

      const housingCat = cats.find((c: any) => c.name === 'Housing')
      const foodCat = cats.find((c: any) => c.name === 'Food')

      // A's account mappings carried over from each source group's default
      expect(housingCat.myMapping.accountId).toBe(housingAcct)
      expect(foodCat.myMapping.accountId).toBe(foodAcct)

      // Shared weights carried over from each source group's member weights
      const housingW = Object.fromEntries(housingCat.weights.map((w: any) => [w.userId, w.weight]))
      const foodW = Object.fromEntries(foodCat.weights.map((w: any) => [w.userId, w.weight]))
      expect(housingW).toEqual({ [userAId]: 60, [userBId]: 40 })
      expect(foodW).toEqual({ [userAId]: 70, [userBId]: 30 })
    })

    it('re-points source expenses onto the merged group + category', async () => {
      const { housing, food } = await twoGroupsWithExpenses()
      const merged = (await (await merge(cookieA, { groupIds: [housing, food], name: 'Household' })).json()) as any
      const housingCatId = merged.categories.find((c: any) => c.name === 'Housing').id

      const rows = await db
        .select({ groupId: groupExpenses.groupId, categoryId: groupExpenses.categoryId, description: groupExpenses.description })
        .from(groupExpenses)
        .where(isNull(groupExpenses.deletedAt))
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.groupId === merged.id)).toBe(true)
      const rent = rows.find((r) => r.description === 'Rent')!
      expect(rent.categoryId).toBe(housingCatId)
    })

    it('merged balances equal the sum of the source balances', async () => {
      const { housing, food } = await twoGroupsWithExpenses()
      const merged = (await (await merge(cookieA, { groupIds: [housing, food], name: 'Household' })).json()) as any

      const bal = await balances(merged.id, cookieA)
      const cad = bal.find((b) => b.currency === 'CAD')!
      const netB = cad.netPositions.find((n: any) => n.userId === userBId).amount
      const netA = cad.netPositions.find((n: any) => n.userId === userAId).amount
      // B owes 40 (Housing) + 30 (Food) = 70; A is owed 70
      expect(netB).toBe('-70.00')
      expect(netA).toBe('70.00')
    })

    it('soft-deletes the source groups', async () => {
      const { housing, food } = await twoGroupsWithExpenses()
      await merge(cookieA, { groupIds: [housing, food], name: 'Household' })

      const live = await db.select().from(expenseGroups).where(isNull(expenseGroups.deletedAt))
      expect(live.map((g) => g.name)).toEqual(['Household'])
    })

    it('collapses old clearing postings into the merged receivable account', async () => {
      const { housing, food } = await twoGroupsWithExpenses()
      const merged = (await (await merge(cookieA, { groupIds: [housing, food], name: 'Household' })).json()) as any

      // Old per-source clearing accounts are soft-deleted
      const oldHousing = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userBId), eq(accounts.path, 'assets:receivable:housing'), isNull(accounts.deletedAt)))
      expect(oldHousing).toHaveLength(0)

      // B's new clearing account holds the collapsed debt: -40 (Housing) + -30 (Food) = -70
      const [newClearing] = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userBId), eq(accounts.path, 'assets:receivable:household'), isNull(accounts.deletedAt)))
      expect(newClearing).toBeDefined()
      const ps = await db
        .select({ amount: postings.amount })
        .from(postings)
        .where(and(eq(postings.accountId, newClearing.id), isNull(postings.deletedAt)))
      const sum = ps.reduce((s, p) => s + parseFloat(p.amount), 0)
      expect(sum).toBeCloseTo(-70, 2)
    })

    it('re-points settlements onto the merged group', async () => {
      const { housing, food } = await twoGroupsWithExpenses()
      // B settles 40 to A in the Housing group before merging
      const payB = await createAccount(cookieB, 'assets:cash')
      const settleRes = await app.request(`/api/fish-pie/groups/${housing}/settlements`, {
        method: 'POST',
        headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId: userBId, toUserId: userAId, amount: '40.00', currency: 'CAD', date: '2026-05-10', payerAccountId: payB }),
      })
      expect(settleRes.status).toBe(201)

      const merged = (await (await merge(cookieA, { groupIds: [housing, food], name: 'Household' })).json()) as any
      const rows = await db.select({ groupId: groupSettlements.groupId }).from(groupSettlements)
      expect(rows.every((r) => r.groupId === merged.id)).toBe(true)
    })

    it('newly created expenses in the merged group use the migrated category weights', async () => {
      const { housing, food } = await twoGroupsWithExpenses()
      const merged = (await (await merge(cookieA, { groupIds: [housing, food], name: 'Household' })).json()) as any
      const housingCatId = merged.categories.find((c: any) => c.name === 'Housing').id

      const expense = (await (await createExpense(merged.id, cookieA, {
        description: 'More rent', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId: payA, categoryId: housingCatId,
      })).json()) as any
      const splitB = expense.splits.find((s: any) => s.userId === userBId)
      expect(splitB.amount).toBe('40.00') // migrated Housing 60/40
    })
  })

  describe('validation', () => {
    it('rejects fewer than two groups', async () => {
      const housing = await createGroup(cookieA, 'Housing')
      const res = await merge(cookieA, { groupIds: [housing], name: 'Household' })
      expect(res.status).toBe(400)
    })

    it('rejects a missing name', async () => {
      const { housing, food } = await twoGroupsWithExpenses()
      const res = await merge(cookieA, { groupIds: [housing, food], name: '  ' })
      expect(res.status).toBe(400)
    })

    it('rejects non-identical member sets', async () => {
      const housing = await createGroup(cookieA, 'Housing')
      await inviteAndAccept(housing, cookieA, 'b@test.com', cookieB)
      const solo = await createGroup(cookieA, 'Solo') // only A
      const res = await merge(cookieA, { groupIds: [housing, solo], name: 'Household' })
      expect(res.status).toBe(400)
    })

    it('rejects a caller who is not a member of all groups', async () => {
      const housing = await createGroup(cookieA, 'Housing')
      await inviteAndAccept(housing, cookieA, 'b@test.com', cookieB)
      // B owns a separate group A is not in
      const bOnly = await createGroup(cookieB, 'BOnly')
      const res = await merge(cookieA, { groupIds: [housing, bOnly], name: 'Household' })
      // A is not a member of bOnly → 403 (or 400 on member-set mismatch, both reject)
      expect([400, 403]).toContain(res.status)
    })

    it('404s for a non-existent group', async () => {
      const housing = await createGroup(cookieA, 'Housing')
      const res = await merge(cookieA, { groupIds: [housing, '00000000-0000-0000-0000-000000000000'], name: 'Household' })
      expect(res.status).toBe(404)
    })
  })
})
