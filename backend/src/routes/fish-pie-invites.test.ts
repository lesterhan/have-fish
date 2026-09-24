import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

describe('fish-pie invites', () => {
  let cookieA: string

  beforeEach(async () => {
    await clearDatabase()
    cookieA = await createTestUser('a@example.com', 'password123')
    await createTestUser('b@example.com', 'password123')
  })

  it('POST /api/fish-pie/groups/:id/invites sends an invite', async () => {
    // A creates a group
    const groupRes = await request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip' }),
    })
    const group = (await groupRes.json()) as any

    // A invites B
    const res = await request(`/api/fish-pie/groups/${group.id}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com' }),
    })
    expect(res.status).toBe(201)
    const invite = (await res.json()) as any
    expect(invite.inviteeEmail).toBe('b@example.com')
    expect(invite.status).toBe('pending')
  })
})
