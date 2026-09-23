import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

describe('fish-pie groups', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('POST /api/fish-pie/groups creates a group and adds creator as member', async () => {
    const res = await request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip to Tokyo' }),
    })
    expect(res.status).toBe(201)
    const group = (await res.json()) as any
    expect(group.name).toBe('Trip to Tokyo')
    expect(group.members).toHaveLength(1)
    expect(group.members[0].shareWeight).toBe(1)
  })
})
