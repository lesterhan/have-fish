import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('reports', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET /api/reports/spending-summary returns empty totals when there are no transactions', async () => {
    const res = await app.request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { total: Record<string, string>; categories: unknown[] }
    expect(body.total).toEqual({})
    expect(body.categories).toEqual([])
  })
})
