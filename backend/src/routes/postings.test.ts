import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('PATCH /api/postings/:id', () => {
  let cookie: string
  const headers = { Cookie: '', 'Content-Type': 'application/json' }

  let postingId: string
  let altAccountId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    headers.Cookie = cookie

    const [accA, accB, accC] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:checking', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:transport', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
    ])

    const tx = await app.request('/api/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
    }).then(r => r.json())

    postingId = tx.postings[0].id
    altAccountId = accC.id
  })

  it('updates accountId of a posting', async () => {
    const res = await app.request(`/api/postings/${postingId}`, { method: 'PATCH', headers, body: JSON.stringify({ accountId: altAccountId }) })
    expect(res.status).toBe(200)
    expect((await res.json()).accountId).toBe(altAccountId)
  })

  it('returns 404 when account does not belong to the user', async () => {
    const otherCookie = await createTestUser('other@example.com', 'password123')
    const otherAccount = await app.request('/api/accounts', { method: 'POST', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json())
    const res = await app.request(`/api/postings/${postingId}`, { method: 'PATCH', headers, body: JSON.stringify({ accountId: otherAccount.id }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 for unknown posting id', async () => {
    const res = await app.request('/api/postings/00000000-0000-0000-0000-000000000000', { method: 'PATCH', headers, body: JSON.stringify({ accountId: altAccountId }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a posting belonging to another user\'s transaction', async () => {
    const otherCookie = await createTestUser('other@example.com', 'password123')
    const res = await app.request(`/api/postings/${postingId}`, { method: 'PATCH', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ accountId: altAccountId }) })
    expect(res.status).toBe(404)
  })
})
