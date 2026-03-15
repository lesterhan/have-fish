import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

describe('categories', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET /api/categories returns an empty array when there are no categories', async () => {
    const res = await app.request('/api/categories', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('POST /api/categories creates an category', async () => {
    const res = await app.request('/api/categories', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Food' }),
    })
    expect(res.status).toBe(201)

    const created = await res.json()
    expect(created.name).toBe('Food')
    expect(created.userId).toBeDefined()

    const getCategoriesRes = await app.request('/api/categories', {
      headers: { Cookie: cookie },
    })
    expect(await getCategoriesRes.json()).toBeArrayOfSize(1)
  })

  it('DELETE /api/categories deletes an category', async () => {
    const createResponse = await app.request('/api/categories', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pants' }),
    })
    const getCategoriesRes = await app.request('/api/categories', {
      headers: { Cookie: cookie },
    })
    expect(await getCategoriesRes.json()).toBeArrayOfSize(1)
    const created = await createResponse.json()

    const res = await app.request(`/api/categories/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(204)

    const getEmptyCategories = await app.request('/api/categories', {
      headers: { Cookie: cookie },
    })
    expect(await getEmptyCategories.json()).toBeArrayOfSize(0)
  })
})

