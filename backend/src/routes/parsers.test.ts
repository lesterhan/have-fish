import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

const validParser = {
  name: 'Big Bank Chequing',
  normalizedHeader: 'amount|date|description',
  columnMapping: { date: 'date', amount: 'amount', description: 'description' },
}

async function createParser(cookie: string, body = validParser) {
  return request('/api/parsers', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('parsers', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  describe('GET /api/parsers', () => {
    it('returns an empty array when there are no parsers', async () => {
      const res = await request('/api/parsers', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it('returns parsers belonging to the current user', async () => {
      await createParser(cookie)
      const res = await request('/api/parsers', { headers: { Cookie: cookie } })
      const body = await res.json()
      expect(body).toBeArrayOfSize(1)
      expect(body[0].name).toBe('Big Bank Chequing')
      expect(body[0].normalizedHeader).toBe('amount|date|description')
      expect(body[0].columnMapping).toEqual({
        date: 'date',
        amount: 'amount',
        description: 'description',
      })
    })

    it('does not return parsers belonging to another user', async () => {
      const otherCookie = await createTestUser('other@example.com')
      await createParser(otherCookie)

      const res = await request('/api/parsers', { headers: { Cookie: cookie } })
      expect(await res.json()).toEqual([])
    })
  })

  describe('POST /api/parsers', () => {
    it('creates a parser and returns 201', async () => {
      const res = await createParser(cookie)
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.id).toBeDefined()
      expect(body.name).toBe('Big Bank Chequing')
      expect(body.deletedAt).toBeNull()
    })

    it('rejects missing name', async () => {
      const res = await createParser(cookie, { ...validParser, name: '' })
      expect(res.status).toBe(400)
    })

    it('rejects missing normalizedHeader', async () => {
      const res = await createParser(cookie, { ...validParser, normalizedHeader: '' })
      expect(res.status).toBe(400)
    })

    it('rejects columnMapping missing date', async () => {
      const res = await createParser(cookie, {
        ...validParser,
        columnMapping: { amount: 'amount' } as any,
      })
      expect(res.status).toBe(400)
    })

    it('rejects columnMapping missing amount', async () => {
      const res = await createParser(cookie, {
        ...validParser,
        columnMapping: { date: 'date' } as any,
      })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/parsers/:id', () => {
    it('soft-deletes a parser so it no longer appears in GET', async () => {
      const created = await (await createParser(cookie)).json()

      const deleteRes = await request(`/api/parsers/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      })
      expect(deleteRes.status).toBe(204)

      const getRes = await request('/api/parsers', { headers: { Cookie: cookie } })
      expect(await getRes.json()).toEqual([])
    })

    it('cannot delete a parser belonging to another user', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const created = await (await createParser(otherCookie)).json()

      // Returns 204 (no error exposed) but the record is untouched
      await request(`/api/parsers/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      })

      const otherParsers = await (
        await request('/api/parsers', { headers: { Cookie: otherCookie } })
      ).json()
      expect(otherParsers).toBeArrayOfSize(1)
    })
  })
})

describe("parsers — another user's accounts as defaults", () => {
  let alice: string
  let bob: string

  beforeEach(async () => {
    await clearDatabase()
    alice = await createTestUser('alice@example.com')
    bob = await createTestUser('bob@example.com')
  })

  async function createAccount(cookie: string, path: string): Promise<{ id: string }> {
    const res = await request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    return res.json()
  }

  function patchParser(cookie: string, id: string, body: Record<string, unknown>) {
    return request(`/api/parsers/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('accepts the caller’s own accounts', async () => {
    const own = await createAccount(alice, 'assets:chequing')
    const fees = await createAccount(alice, 'expenses:fees')

    const res = await createParser(alice, {
      ...validParser,
      defaultAccountId: own.id,
      defaultFeeAccountId: fees.id,
    } as typeof validParser)

    expect(res.status).toBe(201)
  })

  it.each(['defaultAccountId', 'defaultFeeAccountId'])(
    'refuses to create a parser whose %s is not the caller’s',
    async (field) => {
      const foreign = await createAccount(bob, 'assets:bob')

      const res = await createParser(alice, {
        ...validParser,
        [field]: foreign.id,
      } as typeof validParser)

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'SETTING_ACCOUNT_NOT_FOUND', detail: { field } })
      const list = await (await request('/api/parsers', { headers: { Cookie: alice } })).json()
      expect(list).toEqual([])
    },
  )

  it.each(['defaultAccountId', 'defaultFeeAccountId'])(
    'refuses to point %s at another user’s account',
    async (field) => {
      const parser = await (await createParser(alice)).json()
      const foreign = await createAccount(bob, 'assets:bob')

      const res = await patchParser(alice, parser.id, { [field]: foreign.id })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'SETTING_ACCOUNT_NOT_FOUND', detail: { field } })
      const [stored] = await (await request('/api/parsers', { headers: { Cookie: alice } })).json()
      expect(stored[field]).toBeNull()
    },
  )

  it('still clears a default with null', async () => {
    const own = await createAccount(alice, 'assets:chequing')
    const parser = await (
      await createParser(alice, { ...validParser, defaultAccountId: own.id } as typeof validParser)
    ).json()

    const res = await patchParser(alice, parser.id, { defaultAccountId: null })

    expect(res.status).toBe(200)
    expect((await res.json()).defaultAccountId).toBeNull()
  })
})
