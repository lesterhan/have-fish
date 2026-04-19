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

  describe('PATCH /api/transactions/:id', () => {
    let txId: string
    const headers = { Cookie: '', 'Content-Type': 'application/json' }

    beforeEach(async () => {
      headers.Cookie = cookie
      const [accA, accB] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
      ])
      const tx = await app.request('/api/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      }).then(r => r.json())
      txId = tx.id
    })

    it('updates description', async () => {
      const res = await app.request(`/api/transactions/${txId}`, { method: 'PATCH', headers, body: JSON.stringify({ description: 'Dinner' }) })
      expect(res.status).toBe(200)
      expect((await res.json()).description).toBe('Dinner')
    })

    it('updates date', async () => {
      const res = await app.request(`/api/transactions/${txId}`, { method: 'PATCH', headers, body: JSON.stringify({ date: '2026-04-01' }) })
      expect(res.status).toBe(200)
      expect((await res.json()).date).toContain('2026-04-01')
    })

    it('returns 404 for unknown id', async () => {
      const res = await app.request('/api/transactions/00000000-0000-0000-0000-000000000000', { method: 'PATCH', headers, body: JSON.stringify({ description: 'x' }) })
      expect(res.status).toBe(404)
    })

    it('returns 404 for another user\'s transaction', async () => {
      const otherCookie = await createTestUser('other@example.com', 'password123')
      const res = await app.request(`/api/transactions/${txId}`, { method: 'PATCH', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ description: 'x' }) })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/transactions/:id/postings', () => {
    let txId: string
    let accA: { id: string }, accB: { id: string }, accC: { id: string }
    const headers = { Cookie: '', 'Content-Type': 'application/json' }

    beforeEach(async () => {
      headers.Cookie = cookie
      ;[accA, accB, accC] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:transport', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
      ])
      const tx = await app.request('/api/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({ date: '2026-03-01', description: 'Test', postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      }).then(r => r.json())
      txId = tx.id
    })

    it('replaces all postings on a transaction', async () => {
      // Split the expense across two accounts — old postings are fully replaced
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '6.00', currency: 'CAD' }, { accountId: accC.id, amount: '4.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(200)
      expect((await res.json()).postings).toHaveLength(3)
    })

    it('returns 400 when postings do not balance', async () => {
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '5.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when fewer than 2 postings are provided', async () => {
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '0.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown transaction id', async () => {
      const res = await app.request('/api/transactions/00000000-0000-0000-0000-000000000000/postings', {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(404)
    })

    it("returns 404 when an account belongs to another user", async () => {
      const otherCookie = await createTestUser('other@example.com', 'password123')
      const otherHeaders = { ...headers, Cookie: otherCookie }
      const otherAcc = await app.request('/api/accounts', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json())
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: otherAcc.id, amount: '10.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(404)
    })

    it("returns 404 for another user's transaction", async () => {
      const otherCookie = await createTestUser('other@example.com', 'password123')
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers: { ...headers, Cookie: otherCookie },
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/transactions date filtering', () => {
    // Seed two accounts and two transactions on distinct dates before each test.
    // Transaction A: 2026-01-15, Transaction B: 2026-03-01
    beforeEach(async () => {
      const headersJson = { Cookie: cookie, 'Content-Type': 'application/json' }

      const [accA, accB] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers: headersJson, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers: headersJson, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
      ])

      const posting = (accountId: string, amount: string) => ({ accountId, amount, currency: 'CAD' })

      await Promise.all([
        app.request('/api/transactions', { method: 'POST', headers: headersJson, body: JSON.stringify({ date: '2026-01-15', description: 'January tx', postings: [posting(accA.id, '-10.00'), posting(accB.id, '10.00')] }) }),
        app.request('/api/transactions', { method: 'POST', headers: headersJson, body: JSON.stringify({ date: '2026-03-01', description: 'March tx', postings: [posting(accA.id, '-20.00'), posting(accB.id, '20.00')] }) }),
      ])
    })

    it('returns only transactions within the given date range', async () => {
      const res = await app.request('/api/transactions?from=2026-01-01&to=2026-01-31', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].description).toBe('January tx')
    })

    it('returns transactions on or after ?from', async () => {
      const res = await app.request('/api/transactions?from=2026-02-01', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].description).toBe('March tx')
    })

    it('returns transactions on or before ?to', async () => {
      const res = await app.request('/api/transactions?to=2026-01-31', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].description).toBe('January tx')
    })

    it('returns empty array when date range matches nothing', async () => {
      const res = await app.request('/api/transactions?from=2025-01-01&to=2025-12-31', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it('returns all transactions when no date params are given', async () => {
      const res = await app.request('/api/transactions', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      expect(await res.json()).toHaveLength(2)
    })
  })

  describe('POST /api/transactions/bulk', () => {
    const headers = { Cookie: '', 'Content-Type': 'application/json' }
    let accA: { id: string }, accB: { id: string }

    beforeEach(async () => {
      headers.Cookie = cookie
      ;[accA, accB] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
      ])
    })

    it('creates all transactions and returns them', async () => {
      const res = await app.request('/api/transactions/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactions: [
            { date: '2026-01-10', description: 'Grocery run', postings: [{ accountId: accA.id, amount: '-25.00', currency: 'CAD' }, { accountId: accB.id, amount: '25.00', currency: 'CAD' }] },
            { date: '2026-01-11', description: 'Coffee', postings: [{ accountId: accA.id, amount: '-5.00', currency: 'CAD' }, { accountId: accB.id, amount: '5.00', currency: 'CAD' }] },
          ],
        }),
      })
      expect(res.status).toBe(201)
      const created = await res.json()
      expect(created).toHaveLength(2)
      expect(created[0].description).toBe('Grocery run')
      expect(created[1].description).toBe('Coffee')
    })

    it('rolls back the whole batch when one transaction has imbalanced postings', async () => {
      const res = await app.request('/api/transactions/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactions: [
            { date: '2026-01-10', postings: [{ accountId: accA.id, amount: '-25.00', currency: 'CAD' }, { accountId: accB.id, amount: '25.00', currency: 'CAD' }] },
            { date: '2026-01-11', postings: [{ accountId: accA.id, amount: '-5.00', currency: 'CAD' }, { accountId: accB.id, amount: '99.00', currency: 'CAD' }] },
          ],
        }),
      })
      expect(res.status).toBe(400)
      // Confirm nothing was persisted
      const txns = await app.request('/api/transactions', { headers: { Cookie: cookie } }).then(r => r.json())
      expect(txns).toHaveLength(0)
    })
  })
})
