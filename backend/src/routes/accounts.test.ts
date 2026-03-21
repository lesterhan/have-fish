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
