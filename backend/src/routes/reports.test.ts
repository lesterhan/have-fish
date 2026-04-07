import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

// Helper: create an account via the API and return its id
async function createAccount(cookie: string, path: string): Promise<string> {
  const res = await app.request('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ path }),
  })
  const body = await res.json() as { id: string }
  return body.id
}

// Helper: create a balanced transaction via the API
async function createTransaction(
  cookie: string,
  date: string,
  description: string,
  postings: { accountId: string; amount: string; currency: string }[],
): Promise<void> {
  await app.request('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ date, description, postings }),
  })
}

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

  it('GET /api/reports/spending-summary returns childCount and supports prefix drill-down', async () => {
    // Seed accounts: one source + two expense subcategories under expenses:food
    const source     = await createAccount(cookie, 'assets:chq')
    const restaurant = await createAccount(cookie, 'expenses:food:restaurant')
    const groceries  = await createAccount(cookie, 'expenses:food:groceries')

    await createTransaction(cookie, '2025-01-15', 'Dinner', [
      { accountId: source,     amount: '-50.00',  currency: 'CAD' },
      { accountId: restaurant, amount: '50.00',   currency: 'CAD' },
    ])
    await createTransaction(cookie, '2025-01-20', 'Groceries', [
      { accountId: source,    amount: '-120.00', currency: 'CAD' },
      { accountId: groceries, amount: '120.00',  currency: 'CAD' },
    ])

    type Category = { category: string; total: Record<string, string>; childCount: number }

    // Top-level: expenses:food groups both subcategories, childCount should be 2
    const topRes = await app.request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(topRes.status).toBe(200)
    const top = await topRes.json() as { categories: Category[] }
    const foodCat = top.categories.find(c => c.category === 'expenses:food')
    expect(foodCat?.childCount).toBe(2)

    // Drill-down: prefix=expenses:food returns the two subcategories as leaf nodes
    const drillRes = await app.request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31&prefix=expenses:food', {
      headers: { Cookie: cookie },
    })
    expect(drillRes.status).toBe(200)
    const drill = await drillRes.json() as { categories: Category[] }
    expect(drill.categories).toHaveLength(2)
    expect(drill.categories.every(c => c.childCount === 0)).toBe(true)
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
