import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { csvParsers, userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'

// Resolves a user's id from a session cookie via the /api/accounts/me-less path:
// we read it off any created account instead. Simpler: createAccount returns ids, and
// userId is needed only to seed a parser/settings row — fetch it from the settings row.
async function getUserId(cookie: string): Promise<string> {
  const res = await app.request('/api/user-settings', { headers: { Cookie: cookie } })
  const body = await res.json() as { userId: string }
  return body.userId
}

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

  it('GET /api/reports/spending-summary includes all expense postings from a multi-currency cross-currency-spend transaction', async () => {
    // Simulates a cross-currency spend: USD source, USD fee, CZK main spend.
    // Both expense postings must appear in the total — historically the frontend
    // only picked the first expense posting (the fee), missing the CZK spend.
    const source   = await createAccount(cookie, 'assets:wise:usd')
    const equity   = await createAccount(cookie, 'equity:conversions')
    const feeAcct  = await createAccount(cookie, 'expenses:banking:fee')
    const expense  = await createAccount(cookie, 'expenses:food:cafe')

    // Balanced: USD leg: -17.29 + 17.24 + 0.05 = 0; CZK leg: -360.00 + 360.00 = 0
    await createTransaction(cookie, '2025-01-15', 'Prague Coffee', [
      { accountId: source,  amount: '-17.29', currency: 'USD' },
      { accountId: equity,  amount: '17.24',  currency: 'USD' },
      { accountId: feeAcct, amount: '0.05',   currency: 'USD' },
      { accountId: equity,  amount: '-360.00', currency: 'CZK' },
      { accountId: expense, amount: '360.00', currency: 'CZK' },
    ])

    type Category = { category: string; total: Record<string, string>; childCount: number }

    const res = await app.request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { total: Record<string, string>; categories: Category[] }

    // Both expense postings (CZK spend + USD fee) must be reflected in the total
    expect(body.total['CZK']).toBe('360.00')
    expect(body.total['USD']).toBe('0.05')

    const foodCat = body.categories.find((c) => c.category === 'expenses:food')
    expect(foodCat?.total['CZK']).toBe('360.00')

    const bankingCat = body.categories.find((c) => c.category === 'expenses:banking')
    expect(bankingCat?.total['USD']).toBe('0.05')
  })

  it('GET /api/reports/spending-summary excludes configured fee and conversion legs from the total', async () => {
    // Same well-formed cross-currency Wise spend, but this time the fee account is a
    // designated CSV-parser fee account and the equity account is the configured conversion
    // account. Both are mechanical — the spending total should count only the true cafe
    // spend (CZK 360), not the USD fee, and never the conversion leg.
    const source  = await createAccount(cookie, 'assets:wise:usd')
    const equity  = await createAccount(cookie, 'equity:conversions')
    const feeAcct = await createAccount(cookie, 'expenses:banking:fee')
    const expense = await createAccount(cookie, 'expenses:food:cafe')

    const userId = await getUserId(cookie)
    // Designate the conversion account in user settings…
    await db.update(userSettings).set({ defaultConversionAccountId: equity }).where(eq(userSettings.userId, userId))
    // …and the fee account on a CSV parser.
    await db.insert(csvParsers).values({
      userId,
      name: 'Wise',
      normalizedHeader: 'amount|currency|date|description',
      columnMapping: { date: 'date', amount: 'amount' },
      isMultiCurrency: true,
      defaultFeeAccountId: feeAcct,
    })

    await createTransaction(cookie, '2025-01-15', 'Prague Coffee', [
      { accountId: source,  amount: '-17.29', currency: 'USD' },
      { accountId: equity,  amount: '17.24',  currency: 'USD' },
      { accountId: feeAcct, amount: '0.05',   currency: 'USD' },
      { accountId: equity,  amount: '-360.00', currency: 'CZK' },
      { accountId: expense, amount: '360.00', currency: 'CZK' },
    ])

    type Category = { category: string; total: Record<string, string>; childCount: number }
    const res = await app.request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { total: Record<string, string>; categories: Category[] }

    // Only the real spend remains; the USD fee leg is gone from the total.
    expect(body.total['CZK']).toBe('360.00')
    expect(body.total['USD']).toBeUndefined()
    expect(body.categories.find((c) => c.category === 'expenses:banking')).toBeUndefined()
    expect(body.categories.find((c) => c.category === 'expenses:food')?.total['CZK']).toBe('360.00')
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
