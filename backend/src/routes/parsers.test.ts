import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

const validParser = {
  name: 'TD Chequing',
  normalizedHeader: 'amount|date|description',
  columnMapping: { date: 'date', amount: 'amount', description: 'description' },
}

async function createParser(cookie: string, body = validParser) {
  return app.request('/api/parsers', {
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
      const res = await app.request('/api/parsers', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it('returns parsers belonging to the current user', async () => {
      await createParser(cookie)
      const res = await app.request('/api/parsers', { headers: { Cookie: cookie } })
      const body = await res.json()
      expect(body).toBeArrayOfSize(1)
      expect(body[0].name).toBe('Big Bank Chequing')
      expect(body[0].normalizedHeader).toBe('amount|date|description')
      expect(body[0].columnMapping).toEqual({ date: 'date', amount: 'amount', description: 'description' })
    })

    it('does not return parsers belonging to another user', async () => {
      const otherCookie = await createTestUser('other@example.com')
      await createParser(otherCookie)

      const res = await app.request('/api/parsers', { headers: { Cookie: cookie } })
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

      const deleteRes = await app.request(`/api/parsers/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      })
      expect(deleteRes.status).toBe(204)

      const getRes = await app.request('/api/parsers', { headers: { Cookie: cookie } })
      expect(await getRes.json()).toEqual([])
    })

    it('cannot delete a parser belonging to another user', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const created = await (await createParser(otherCookie)).json()

      // Returns 204 (no error exposed) but the record is untouched
      await app.request(`/api/parsers/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      })

      const otherParsers = await (await app.request('/api/parsers', { headers: { Cookie: otherCookie } })).json()
      expect(otherParsers).toBeArrayOfSize(1)
    })
  })
})
