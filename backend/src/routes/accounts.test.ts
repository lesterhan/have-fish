import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase } from '../test-utils'

describe('accounts', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it('GET /api/accounts returns an empty array when there are no accounts', async () => {
    const res = await app.request('/api/accounts')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // your tests go here
})
