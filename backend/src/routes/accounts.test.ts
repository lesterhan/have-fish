import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import type { accounts as accountsTable } from '../db/schema.ts'

type Account = typeof accountsTable.$inferSelect

describe('accounts', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET /api/accounts returns only default accounts when there are no custom accounts', async () => {
    const res = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const allAccounts = await res.json() as Account[]
    expect(allAccounts.map(a => a.path)).toEqual(
      expect.arrayContaining(['expenses:uncategorized', 'equity:conversions'])
    )
  })

  it('POST /api/accounts creates an account', async () => {
    const res = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets:chequing' }),
    })
    expect(res.status).toBe(201)

    const created = await res.json() as Account
    expect(created.path).toBe('assets:chequing')
    expect(created.userId).toBeDefined()

    const getRes = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })
    expect(await getRes.json()).toEqual(expect.arrayContaining([
      expect.objectContaining(created)
    ]))
  })

  describe('GET /api/accounts/balances', () => {
    // Helper: create an account and return its id
    async function createAccount(path: string) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return (await res.json() as Account).id
    }

    // Helper: create a transaction with the given postings
    async function createTransaction(postingInputs: { accountId: string; amount: string; currency: string }[]) {
      return app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2024-01-01', postings: postingInputs }),
      })
    }

    it('returns asset accounts with their summed balances', async () => {
      const assetId = await createAccount('assets:chequing')
      const expenseId = await createAccount('expenses:food')

      await createTransaction([
        { accountId: assetId, amount: '1000.00', currency: 'CAD' },
        { accountId: expenseId, amount: '-1000.00', currency: 'CAD' },
      ])

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const body = await res.json() as { path: string; balances: { currency: string; amount: string }[] }[]

      // Only the assets account should appear — expenses:food is excluded
      const paths = body.map(b => b.path)
      expect(paths).toContain('assets:chequing')
      expect(paths).not.toContain('expenses:food')

      const chequing = body.find(b => b.path === 'assets:chequing')!
      expect(chequing.balances).toEqual([{ currency: 'CAD', amount: '1000.00' }])
    })

    it('returns an account with no postings as empty balances', async () => {
      await createAccount('assets:savings')

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      const body = await res.json() as { path: string; balances: unknown[] }[]

      const savings = body.find(b => b.path === 'assets:savings')
      expect(savings).toBeDefined()
      expect(savings!.balances).toEqual([])
    })

    it('returns multiple currency balances for a multi-currency account', async () => {
      const assetId = await createAccount('assets:wise:cad')
      const conversionId = await createAccount('equity:conversions')

      // Two transactions in different currencies
      await createTransaction([
        { accountId: assetId, amount: '500.00', currency: 'CAD' },
        { accountId: conversionId, amount: '-500.00', currency: 'CAD' },
      ])
      await createTransaction([
        { accountId: assetId, amount: '200.00', currency: 'GBP' },
        { accountId: conversionId, amount: '-200.00', currency: 'GBP' },
      ])

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      const body = await res.json() as { path: string; balances: { currency: string; amount: string }[] }[]

      const wise = body.find(b => b.path === 'assets:wise:cad')!
      expect(wise.balances).toHaveLength(2)
      expect(wise.balances).toEqual(expect.arrayContaining([
        { currency: 'CAD', amount: '500.00' },
        { currency: 'GBP', amount: '200.00' },
      ]))
    })
  })

  describe('GET /api/accounts/:id/balance', () => {
    async function createAccount(path: string) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return (await res.json() as { id: string }).id
    }

    async function createTransaction(date: string, postingInputs: { accountId: string; amount: string; currency: string }[]) {
      return app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, postings: postingInputs }),
      })
    }

    it('returns balance as of the given date, excluding later transactions', async () => {
      const assetId = await createAccount('assets:chequing')
      const expenseId = await createAccount('expenses:food')

      await createTransaction('2024-01-01', [
        { accountId: assetId, amount: '1000.00', currency: 'CAD' },
        { accountId: expenseId, amount: '-1000.00', currency: 'CAD' },
      ])
      await createTransaction('2024-03-01', [
        { accountId: assetId, amount: '500.00', currency: 'CAD' },
        { accountId: expenseId, amount: '-500.00', currency: 'CAD' },
      ])

      const res = await app.request(`/api/accounts/${assetId}/balance?date=2024-01-31`, {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { accountId: string; date: string; balances: { currency: string; amount: string }[] }
      expect(body.balances).toEqual([{ currency: 'CAD', amount: '1000.00' }])
    })
  })

  it('DELETE /api/accounts/:id soft-deletes an account', async () => {
    const createRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets:chequing' }),
    })
    const created = await createRes.json()

    const deleteRes = await app.request(`/api/accounts/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(deleteRes.status).toBe(204)

    const getRes = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })

    const allAccounts = await getRes.json() as Account[]
    expect(allAccounts.map(a => a.id)).not.toContain(created.id)
  })
})
