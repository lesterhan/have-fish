import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('fish-pie balances', () => {
  let cookieA: string
  let cookieB: string
  let cookieC: string
  let groupId: string
  let userAId: string
  let userBId: string
  let userCId: string

  beforeEach(async () => {
    await clearDatabase()

    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')
    cookieC = await createTestUser('c@test.com', 'passwordC')

    // Get user IDs from session
    const sessionA = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    const sessionC = await app.request('/api/auth/get-session', { headers: { Cookie: cookieC } })
    userAId = ((await sessionA.json()) as any).user.id
    userBId = ((await sessionB.json()) as any).user.id
    userCId = ((await sessionC.json()) as any).user.id

    // Alice creates group
    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip' }),
    })
    groupId = ((await groupRes.json()) as any).id

    // Invite and accept Bob and Carol
    for (const [email, cookie] of [['b@test.com', cookieB], ['c@test.com', cookieC]]) {
      const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const inviteId = ((await invRes.json()) as any).id
      await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    }
  })

  it('3 members, 1 expense — correct net positions and minimal transfers', async () => {
    // Alice pays CAD 90 for all three (equal split = 30 each)
    // Alice net: +90 - 30 = +60, Bob net: -30, Carol net: -30
    // Transfers: Bob → Alice 30, Carol → Alice 30
    await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Hotel', amount: '90.00', currency: 'CAD', date: '2026-04-28', paidByUserId: userAId }),
    })

    const res = await app.request(`/api/fish-pie/groups/${groupId}/balances`, {
      headers: { Cookie: cookieA },
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as any[]
    expect(data).toHaveLength(1)

    const cad = data[0]
    expect(cad.currency).toBe('CAD')

    const aliceNet = cad.netPositions.find((n: any) => n.userId === userAId)
    const bobNet = cad.netPositions.find((n: any) => n.userId === userBId)
    const carolNet = cad.netPositions.find((n: any) => n.userId === userCId)

    expect(aliceNet.amount).toBe('60.00')
    expect(bobNet.amount).toBe('-30.00')
    expect(carolNet.amount).toBe('-30.00')

    expect(cad.transfers).toHaveLength(2)
    // Both transfers go to Alice
    expect(cad.transfers.every((t: any) => t.toUserId === userAId)).toBe(true)
    const transferTotal = cad.transfers.reduce((s: number, t: any) => s + parseFloat(t.amount), 0)
    expect(transferTotal.toFixed(2)).toBe('60.00')
  })
})
