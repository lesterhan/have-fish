import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('fish-pie settlements', () => {
  let cookieA: string
  let cookieB: string
  let groupId: string
  let userAId: string
  let userBId: string

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
      body: JSON.stringify({ name: 'Trip' }),
    })
    groupId = ((await groupRes.json()) as any).id

    const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@test.com' }),
    })
    const inviteId = ((await invRes.json()) as any).id
    await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: { Cookie: cookieB },
    })
  })

  it('POST records settlement and GET lists it', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: userBId, toUserId: userAId, amount: '30.00', currency: 'CAD', date: '2026-04-28' }),
    })
    expect(res.status).toBe(201)
    const s = (await res.json()) as any
    expect(s.amount).toBe('30.00')
    expect(s.currency).toBe('CAD')

    const listRes = await app.request(`/api/fish-pie/groups/${groupId}/settlements`, {
      headers: { Cookie: cookieA },
    })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as any[]
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(s.id)
  })
})
