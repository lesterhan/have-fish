import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

// Helpers ---------------------------------------------------------------------

async function getUserId(cookie: string): Promise<string> {
  const res = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
  return ((await res.json()) as any).user.id
}

async function createGroup(cookie: string, name = 'Household'): Promise<string> {
  const res = await app.request('/api/fish-pie/groups', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as any).id
}

async function createAccount(cookie: string, path: string, name?: string): Promise<string> {
  const res = await app.request('/api/accounts', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name: name ?? path }),
  })
  return ((await res.json()) as any).id
}

async function inviteAndAccept(groupId: string, ownerCookie: string, email: string, memberCookie: string) {
  const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
    method: 'POST',
    headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const inviteId = ((await invRes.json()) as any).id
  await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
    method: 'POST',
    headers: { Cookie: memberCookie },
  })
}

function createCategory(groupId: string, cookie: string, body: Record<string, unknown>) {
  return app.request(`/api/fish-pie/groups/${groupId}/categories`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Tests -----------------------------------------------------------------------

describe('fish-pie categories', () => {
  let cookie: string
  let groupId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    groupId = await createGroup(cookie)
  })

  describe('CRUD', () => {
    it('POST creates a category with a default sortOrder', async () => {
      const res = await createCategory(groupId, cookie, { name: 'Food' })
      expect(res.status).toBe(201)
      const cat = (await res.json()) as any
      expect(cat.name).toBe('Food')
      expect(cat.groupId).toBe(groupId)
      expect(cat.sortOrder).toBe(0)
      expect(cat.archivedAt).toBeNull()
      expect(cat.myMapping).toBeNull()
    })

    it('POST defaults sortOrder to the end of the list', async () => {
      await createCategory(groupId, cookie, { name: 'Food' })
      const res = await createCategory(groupId, cookie, { name: 'Housing' })
      expect(((await res.json()) as any).sortOrder).toBe(1)
    })

    it('POST honours an explicit sortOrder', async () => {
      const res = await createCategory(groupId, cookie, { name: 'Food', sortOrder: 5 })
      expect(((await res.json()) as any).sortOrder).toBe(5)
    })

    it('POST rejects a blank name', async () => {
      const res = await createCategory(groupId, cookie, { name: '   ' })
      expect(res.status).toBe(400)
    })

    it('GET lists categories sorted by sortOrder then name', async () => {
      await createCategory(groupId, cookie, { name: 'Housing', sortOrder: 1 })
      await createCategory(groupId, cookie, { name: 'Food', sortOrder: 0 })
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(200)
      const cats = (await res.json()) as any[]
      expect(cats.map((c) => c.name)).toEqual(['Food', 'Housing'])
    })

    it('PATCH renames a category', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Groceries' }),
      })
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).name).toBe('Groceries')
    })

    it('PATCH archives and un-archives a category', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any

      const archived = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })).json()) as any
      expect(archived.archivedAt).not.toBeNull()

      const unarchived = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      })).json()) as any
      expect(unarchived.archivedAt).toBeNull()
    })

    it('PATCH rejects an empty body', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('PATCH 404s for a category in another group', async () => {
      const otherGroup = await createGroup(cookie, 'Other')
      const cat = (await (await createCategory(otherGroup, cookie, { name: 'Food' })).json()) as any
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('member-scoped mapping', () => {
    let cookieB: string
    let accountA: string

    beforeEach(async () => {
      cookieB = await createTestUser('b@test.com', 'passwordB')
      await inviteAndAccept(groupId, cookie, 'b@test.com', cookieB)
      accountA = await createAccount(cookie, 'expenses:food', 'Food')
    })

    it('PUT my-mapping upserts the caller’s own account mapping', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}/my-mapping`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountA }),
      })
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).accountId).toBe(accountA)

      // Surfaced on the category GET for that member
      const cats = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: cookie },
      })).json()) as any[]
      expect(cats[0].myMapping).toEqual({ accountId: accountA })
    })

    it('PUT my-mapping is idempotent (second call updates, not duplicates)', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      const account2 = await createAccount(cookie, 'expenses:dining', 'Dining')
      const put = (b: Record<string, unknown>) =>
        app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}/my-mapping`, {
          method: 'PUT',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify(b),
        })
      await put({ accountId: accountA })
      const res = await put({ accountId: account2 })
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).accountId).toBe(account2)

      const cats = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: cookie },
      })).json()) as any[]
      expect(cats[0].myMapping).toEqual({ accountId: account2 })
    })

    it('PUT my-mapping rejects an account the caller does not own', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      const accountB = await createAccount(cookieB, 'expenses:groceries', 'Groceries')
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}/my-mapping`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountB }),
      })
      expect(res.status).toBe(400)
    })

    it('two members map the same category to their own accounts independently', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      const accountB = await createAccount(cookieB, 'expenses:groceries', 'Groceries')

      await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}/my-mapping`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountA }),
      })
      await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}/my-mapping`, {
        method: 'PUT',
        headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountB }),
      })

      const catsA = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: cookie },
      })).json()) as any[]
      const catsB = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: cookieB },
      })).json()) as any[]

      expect(catsA[0].myMapping).toEqual({ accountId: accountA })
      expect(catsB[0].myMapping).toEqual({ accountId: accountB })
    })
  })

  describe('shared category weights', () => {
    let cookieB: string
    let userId: string
    let userBId: string

    beforeEach(async () => {
      cookieB = await createTestUser('b@test.com', 'passwordB')
      await inviteAndAccept(groupId, cookie, 'b@test.com', cookieB)
      userId = await getUserId(cookie)
      userBId = await getUserId(cookieB)
    })

    function putWeights(catId: string, asCookie: string, weights: { userId: string; weight: number }[]) {
      return app.request(`/api/fish-pie/groups/${groupId}/categories/${catId}/weights`, {
        method: 'PUT',
        headers: { Cookie: asCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights }),
      })
    }

    it('any member can set the whole vector (agreement implied)', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Housing' })).json()) as any
      // Member B sets weights for BOTH members
      const res = await putWeights(cat.id, cookieB, [
        { userId, weight: 60 },
        { userId: userBId, weight: 40 },
      ])
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      const map = Object.fromEntries(body.weights.map((w: any) => [w.userId, w.weight]))
      expect(map).toEqual({ [userId]: 60, [userBId]: 40 })
    })

    it('weights are shared — visible to every member on GET', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Housing' })).json()) as any
      await putWeights(cat.id, cookie, [{ userId, weight: 70 }, { userId: userBId, weight: 30 }])

      const catsB = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: cookieB },
      })).json()) as any[]
      const map = Object.fromEntries(catsB[0].weights.map((w: any) => [w.userId, w.weight]))
      expect(map).toEqual({ [userId]: 70, [userBId]: 30 })
    })

    it('rejects a partial vector (must cover every member)', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Housing' })).json()) as any
      // 2-member group, only one weight supplied → 400
      const res = await putWeights(cat.id, cookie, [{ userId, weight: 100 }])
      expect(res.status).toBe(400)
    })

    it('an empty vector clears the weights', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Housing' })).json()) as any
      await putWeights(cat.id, cookie, [{ userId, weight: 60 }, { userId: userBId, weight: 40 }])
      const res = await putWeights(cat.id, cookie, [])
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).weights).toEqual([])
    })

    it('rejects a weight for a non-member', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Housing' })).json()) as any
      const res = await putWeights(cat.id, cookie, [{ userId: 'not-a-member', weight: 50 }])
      expect(res.status).toBe(400)
    })

    it('rejects a non-positive weight', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Housing' })).json()) as any
      const res = await putWeights(cat.id, cookie, [{ userId, weight: 0 }])
      expect(res.status).toBe(400)
    })

    it('non-member cannot set weights', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Housing' })).json()) as any
      const outsider = await createTestUser('out@test.com', 'passwordO')
      const res = await putWeights(cat.id, outsider, [{ userId, weight: 50 }])
      expect(res.status).toBe(404)
    })
  })

  describe('archived categories resolvability', () => {
    it('GET still returns archived categories (resolvable for existing expenses)', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      const cats = (await (await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: cookie },
      })).json()) as any[]
      expect(cats).toHaveLength(1)
      expect(cats[0].archivedAt).not.toBeNull()
    })
  })

  describe('group GET embeds categories', () => {
    it('GET /:id includes the caller’s categories with their mapping', async () => {
      const account = await createAccount(cookie, 'expenses:food', 'Food')
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}/my-mapping`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account }),
      })

      const group = (await (await app.request(`/api/fish-pie/groups/${groupId}`, {
        headers: { Cookie: cookie },
      })).json()) as any
      expect(group.categories).toHaveLength(1)
      expect(group.categories[0].name).toBe('Food')
      expect(group.categories[0].myMapping.accountId).toBe(account)
    })

    it('GET / list includes categories per group', async () => {
      await createCategory(groupId, cookie, { name: 'Food' })
      const groups = (await (await app.request('/api/fish-pie/groups', {
        headers: { Cookie: cookie },
      })).json()) as any[]
      const g = groups.find((x) => x.id === groupId)
      expect(g.categories).toHaveLength(1)
    })
  })

  describe('membership auth', () => {
    let outsiderCookie: string

    beforeEach(async () => {
      outsiderCookie = await createTestUser('outsider@test.com', 'passwordX')
    })

    it('non-member cannot list categories', async () => {
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
        headers: { Cookie: outsiderCookie },
      })
      expect(res.status).toBe(404)
    })

    it('non-member cannot create a category', async () => {
      const res = await createCategory(groupId, outsiderCookie, { name: 'Food' })
      expect(res.status).toBe(404)
    })

    it('non-member cannot set a mapping', async () => {
      const cat = (await (await createCategory(groupId, cookie, { name: 'Food' })).json()) as any
      const account = await createAccount(outsiderCookie, 'expenses:food', 'Food')
      const res = await app.request(`/api/fish-pie/groups/${groupId}/categories/${cat.id}/my-mapping`, {
        method: 'PUT',
        headers: { Cookie: outsiderCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account }),
      })
      expect(res.status).toBe(404)
    })
  })
})
