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
      body: JSON.stringify({ path: 'assets:chequing' }),
    })
    expect(res.status).toBe(201)

    const created = await res.json()
    expect(created.path).toBe('assets:chequing')
    expect(created.userId).toBeDefined()

    const getRes = await app.request('/api/accounts', {
      headers: { Cookie: cookie },
    })
    expect(await getRes.json()).toBeArrayOfSize(1)
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
    expect(await getRes.json()).toBeArrayOfSize(0)
  })
})
