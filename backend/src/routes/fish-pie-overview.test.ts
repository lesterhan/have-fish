import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('fish-pie group overview', () => {
  let cookieA: string
  let cookieB: string
  let groupId: string
  let userAId: string
  let userBId: string
  let paymentAccountId: string

  beforeEach(async () => {
    await clearDatabase()

    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')

    const sessionA = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    userAId = ((await sessionA.json()) as any).user.id
    userBId = ((await sessionB.json()) as any).user.id

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Household' }),
    })
    groupId = ((await groupRes.json()) as any).id

    const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@test.com' }),
    })
    const inviteId = ((await invRes.json()) as any).id
    await app.request(`/api/fish-pie/invites/${inviteId}/accept`, { method: 'POST', headers: { Cookie: cookieB } })

    const acctRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa', name: 'Visa' }),
    })
    paymentAccountId = ((await acctRes.json()) as any).id
  })

  async function addExpense(amount: string, paidBy: string, cookie: string, payAcct: string) {
    return app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Groceries', amount, currency: 'CAD', date: '2026-05-01', paidByUserId: paidBy, paymentAccountId: payAcct }),
    })
  }

  it('returns group, expenses, settlements, invites and balances in one payload', async () => {
    await addExpense('100.00', userAId, cookieA, paymentAccountId)

    const res = await app.request(`/api/fish-pie/groups/${groupId}/overview`, { headers: { Cookie: cookieA } })
    expect(res.status).toBe(200)
    const data = (await res.json()) as any

    // Group with members + categories
    expect(data.group.id).toBe(groupId)
    expect(data.group.members).toHaveLength(2)
    expect(Array.isArray(data.group.categories)).toBe(true)

    // Expenses list
    expect(data.expenses).toHaveLength(1)
    expect(data.expenses[0].amount).toBe('100.00')
    expect(data.expenses[0].splits.length).toBeGreaterThan(0)

    // Settlements + invites arrays present (empty here)
    expect(data.settlements).toEqual([])
    expect(data.invites).toEqual([])

    // Balances match the dedicated endpoint
    expect(data.balances).toHaveLength(1)
    const cad = data.balances[0]
    const aliceNet = cad.netPositions.find((n: any) => n.userId === userAId)
    const bobNet = cad.netPositions.find((n: any) => n.userId === userBId)
    expect(aliceNet.amount).toBe('50.00') // paid 100, owes 50
    expect(bobNet.amount).toBe('-50.00')
  })

  it("overview balances equal the standalone /balances endpoint", async () => {
    await addExpense('100.00', userAId, cookieA, paymentAccountId)
    await addExpense('40.00', userBId, cookieB, paymentAccountId)

    const [overviewRes, balancesRes] = await Promise.all([
      app.request(`/api/fish-pie/groups/${groupId}/overview`, { headers: { Cookie: cookieA } }),
      app.request(`/api/fish-pie/groups/${groupId}/balances`, { headers: { Cookie: cookieA } }),
    ])
    const overview = (await overviewRes.json()) as any
    const balances = (await balancesRes.json()) as any
    expect(overview.balances).toEqual(balances)
  })

  it('expenses are newest-first', async () => {
    await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Old', amount: '10.00', currency: 'CAD', date: '2026-01-01', paidByUserId: userAId, paymentAccountId }),
    })
    await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'New', amount: '20.00', currency: 'CAD', date: '2026-12-31', paidByUserId: userAId, paymentAccountId }),
    })

    const res = await app.request(`/api/fish-pie/groups/${groupId}/overview`, { headers: { Cookie: cookieA } })
    const data = (await res.json()) as any
    expect(data.expenses[0].description).toBe('New')
    expect(data.expenses[1].description).toBe('Old')
  })

  it('includes pending invites', async () => {
    const cookieC = await createTestUser('c@test.com', 'passwordC')
    void cookieC
    await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'c@test.com' }),
    })

    const res = await app.request(`/api/fish-pie/groups/${groupId}/overview`, { headers: { Cookie: cookieA } })
    const data = (await res.json()) as any
    expect(data.invites).toHaveLength(1)
    expect(data.invites[0].inviteeEmail).toBe('c@test.com')
  })

  it('404s for a non-member', async () => {
    const cookieD = await createTestUser('d@test.com', 'passwordD')
    const res = await app.request(`/api/fish-pie/groups/${groupId}/overview`, { headers: { Cookie: cookieD } })
    expect(res.status).toBe(404)
  })

  it('404s for an unknown group', async () => {
    const res = await app.request(`/api/fish-pie/groups/00000000-0000-0000-0000-000000000000/overview`, { headers: { Cookie: cookieA } })
    expect(res.status).toBe(404)
  })
})
