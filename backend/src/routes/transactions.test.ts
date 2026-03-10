import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase } from '../test-utils'

describe('transactions', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it('GET /api/transactions returns an empty array when there are no transactions', async () => {
    const res = await app.request('/api/transactions')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // your tests go here
})
