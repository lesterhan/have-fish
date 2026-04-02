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

  it('GET /api/reports/monthly-spend returns one entry per month with empty totals when there are no transactions', async () => {
    const res = await app.request('/api/reports/monthly-spend?months=3', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { month: string; total: Record<string, string> }[]
    expect(body).toHaveLength(3)
    // All entries should have empty totals
    expect(body.every(entry => Object.keys(entry.total).length === 0)).toBe(true)
    // Months should be in ascending order
    expect(body[0].month < body[1].month).toBe(true)
    expect(body[1].month < body[2].month).toBe(true)
  })
})
