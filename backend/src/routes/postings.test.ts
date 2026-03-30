import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

// Shared setup: two accounts, one transaction with two postings
async function setup(headers: Record<string, string>) {
  const [accA, accB, accC] = await Promise.all([
    app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
    app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
    app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:transport', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
  ])
  const tx = await app.request('/api/transactions', {
    method: 'POST', headers,
    body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
  }).then(r => r.json())
  return { accA, accB, accC, tx, postingA: tx.postings[0], postingB: tx.postings[1] }
}

describe('PATCH /api/postings/:id', () => {
  let cookie: string
  const headers = { Cookie: '', 'Content-Type': 'application/json' }
  let postingId: string
  let altAccountId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    headers.Cookie = cookie
    const { postingA, accC } = await setup(headers)
    postingId = postingA.id
    altAccountId = accC.id
  })

  it('updates accountId of a posting', async () => {
    const res = await app.request(`/api/postings/${postingId}`, { method: 'PATCH', headers, body: JSON.stringify({ accountId: altAccountId }) })
    expect(res.status).toBe(200)
    expect((await res.json()).accountId).toBe(altAccountId)
  })

  it('updates amount and currency of a posting', async () => {
    const res = await app.request(`/api/postings/${postingId}`, { method: 'PATCH', headers, body: JSON.stringify({ amount: '-25.00', currency: 'USD' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.amount).toBe('-25.00')
    expect(body.currency).toBe('USD')
  })

  it('returns 400 when no fields provided', async () => {
    const res = await app.request(`/api/postings/${postingId}`, { method: 'PATCH', headers, body: JSON.stringify({}) })
    expect(res.status).toBe(400)
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

  it("returns 404 for a posting belonging to another user's transaction", async () => {
    const otherCookie = await createTestUser('other@example.com', 'password123')
    const res = await app.request(`/api/postings/${postingId}`, { method: 'PATCH', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ accountId: altAccountId }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/postings', () => {
  let cookie: string
  const headers = { Cookie: '', 'Content-Type': 'application/json' }

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    headers.Cookie = cookie
  })

  it('creates a posting on an existing transaction', async () => {
    const { accC, tx } = await setup(headers)
    const res = await app.request('/api/postings', {
      method: 'POST', headers,
      body: JSON.stringify({ transactionId: tx.id, accountId: accC.id, amount: '5.00', currency: 'CAD' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.transactionId).toBe(tx.id)
    expect(body.amount).toBe('5.00')
  })

  it('returns 404 for unknown transaction', async () => {
    const { accC } = await setup(headers)
    const res = await app.request('/api/postings', {
      method: 'POST', headers,
      body: JSON.stringify({ transactionId: '00000000-0000-0000-0000-000000000000', accountId: accC.id, amount: '5.00', currency: 'CAD' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/postings/:id', () => {
  let cookie: string
  const headers = { Cookie: '', 'Content-Type': 'application/json' }

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    headers.Cookie = cookie
  })

  it('soft-deletes a posting when 3+ active postings exist', async () => {
    const { accC, tx, postingA } = await setup(headers)
    // Add a third posting so we can delete one
    await app.request('/api/postings', {
      method: 'POST', headers,
      body: JSON.stringify({ transactionId: tx.id, accountId: accC.id, amount: '0.00', currency: 'CAD' }),
    })
    const res = await app.request(`/api/postings/${postingA.id}`, { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    expect((await res.json()).deletedAt).not.toBeNull()
  })

  it('returns 400 when only 2 postings remain', async () => {
    const { postingA } = await setup(headers)
    const res = await app.request(`/api/postings/${postingA.id}`, { method: 'DELETE', headers })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown posting', async () => {
    const res = await app.request('/api/postings/00000000-0000-0000-0000-000000000000', { method: 'DELETE', headers })
    expect(res.status).toBe(404)
  })
})
