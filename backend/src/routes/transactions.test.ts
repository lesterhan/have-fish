import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('transactions', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET /api/transactions returns an empty array when there are no transactions', async () => {
    const res = await app.request('/api/transactions', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // your tests go here
})
