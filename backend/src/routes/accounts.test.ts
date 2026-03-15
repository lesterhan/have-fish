import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('accounts', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET /api/accounts returns an empty array when there are no accounts', async () => {
    const res = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('POST /api/accounts creates an account', async () => {
    const res = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cash', type: 'cash', currency: 'CAD' }),
    })
    expect(res.status).toBe(201)

    const created = await res.json()
    expect(created.name).toBe('Cash')
    expect(created.type).toBe('cash')
    expect(created.userId).toBeDefined()

    const getAccountsRes = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })
    expect(await getAccountsRes.json()).toBeArrayOfSize(1)
  })

  it('DELETE /api/accounts deletes an account', async () => {
    const createResponse = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cash', type: 'cash', currency: 'CAD' }),
    })
    const getAccountsRes = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })
    expect(await getAccountsRes.json()).toBeArrayOfSize(1)
    const created = await createResponse.json()

    const res = await app.request(`/api/accounts/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(204)

    const getEmptyAccounts = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })
    expect(await getEmptyAccounts.json()).toBeArrayOfSize(0)
  })
})

