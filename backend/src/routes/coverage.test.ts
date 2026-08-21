import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { accountCoverage, accounts } from '../db/schema'
import { eq } from 'drizzle-orm'

async function createAccount(userId: string, path: string) {
  const [acct] = await db.insert(accounts).values({ userId, path }).returning()
  return acct
}

async function userIdFor(cookie: string) {
  const res = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
  const session = await res.json()
  return session.user.id as string
}

// Posts an assertion through the API so writes go via the same validation the app uses.
async function postCoverage(
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request('/api/coverage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

async function getCoverage(cookie: string, accountId: string) {
  return app.request(`/api/accounts/${accountId}/coverage`, { headers: { Cookie: cookie } })
}

describe('coverage', () => {
  let cookie: string
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    userId = await userIdFor(cookie)
  })

  describe('POST /api/coverage', () => {
    it('creates an assertion', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'import',
        note: 'rbc-july.csv',
      })

      expect(res.status).toBe(201)
      const created = await res.json()
      expect(created).toMatchObject({
        accountId: acct.id,
        userId,
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'import',
        note: 'rbc-july.csv',
        deletedAt: null,
      })
      expect(created.id).toBeString()
    })

    it('accepts an assertion without a note', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'manual',
      })

      expect(res.status).toBe(201)
      expect((await res.json()).note).toBeNull()
    })

    it('accepts a single-day range', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '2025-07-15',
        throughDate: '2025-07-15',
        source: 'reconcile',
      })

      expect(res.status).toBe(201)
    })

    it('accepts all four sources', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      for (const source of ['import', 'reconcile', 'manual', 'empty']) {
        const res = await postCoverage(cookie, {
          accountId: acct.id,
          fromDate: '2025-07-01',
          throughDate: '2025-07-31',
          source,
        })
        expect(res.status).toBe(201)
      }
    })

    it('rejects an unknown source', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'guessed',
      })

      expect(res.status).toBe(400)
    })

    it('rejects an inverted range', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '2025-07-31',
        throughDate: '2025-07-01',
        source: 'manual',
      })

      expect(res.status).toBe(400)
    })

    it('rejects a malformed date', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '01/07/2025',
        throughDate: '2025-07-31',
        source: 'manual',
      })

      expect(res.status).toBe(400)
    })

    // The regex alone would let this through; the round-trip check is what catches it.
    it('rejects a date that does not exist on the calendar', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '2025-02-01',
        throughDate: '2025-02-30',
        source: 'manual',
      })

      expect(res.status).toBe(400)
    })

    it('rejects a missing accountId', async () => {
      const res = await postCoverage(cookie, {
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'manual',
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 rather than 500 for a malformed accountId', async () => {
      const res = await postCoverage(cookie, {
        accountId: 'not-a-uuid',
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'manual',
      })

      expect(res.status).toBe(400)
    })

    it('rejects an accountId that does not exist', async () => {
      const res = await postCoverage(cookie, {
        accountId: '00000000-0000-4000-8000-000000000000',
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'manual',
      })

      expect(res.status).toBe(404)
    })

    // Coverage is an assertion about someone's ledger — writing one into a stranger's
    // account would silently tell them they were caught up when they were not.
    it('refuses to write coverage against another user\'s account', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const otherUserId = await userIdFor(otherCookie)
      const theirAccount = await createAccount(otherUserId, 'assets:their-chequing')

      const res = await postCoverage(cookie, {
        accountId: theirAccount.id,
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'manual',
      })

      expect(res.status).toBe(404)

      const rows = await db.select().from(accountCoverage).where(eq(accountCoverage.accountId, theirAccount.id))
      expect(rows).toHaveLength(0)
    })

    it('refuses to write coverage against a soft-deleted account', async () => {
      const acct = await createAccount(userId, 'assets:closed')
      await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, acct.id))

      const res = await postCoverage(cookie, {
        accountId: acct.id,
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'manual',
      })

      expect(res.status).toBe(404)
    })

    it('requires authentication', async () => {
      const res = await app.request('/api/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: '00000000-0000-4000-8000-000000000000', fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'manual' }),
      })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/accounts/:id/coverage', () => {
    it('returns nothing for an account with no assertions', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await getCoverage(cookie, acct.id)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ accountId: acct.id, intervals: [], assertions: [] })
    })

    it('returns merged spans newest first', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-06-01', throughDate: '2025-06-30', source: 'import' })
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-09-01', throughDate: '2025-09-30', source: 'import' })

      const { intervals } = await (await getCoverage(cookie, acct.id)).json()

      expect(intervals).toEqual([
        { fromDate: '2025-09-01', throughDate: '2025-09-30' },
        { fromDate: '2025-06-01', throughDate: '2025-06-30' },
      ])
    })

    // Two consecutive monthly statements are one unbroken span, not two with a hole between.
    it('merges consecutive monthly statements into one span', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-06-01', throughDate: '2025-06-30', source: 'import' })
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import' })

      const { intervals } = await (await getCoverage(cookie, acct.id)).json()

      expect(intervals).toEqual([{ fromDate: '2025-06-01', throughDate: '2025-07-31' }])
    })

    it('merges an overlapping re-import without duplicating the span', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import' })
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-07-15', throughDate: '2025-08-15', source: 'import' })

      const { intervals } = await (await getCoverage(cookie, acct.id)).json()

      expect(intervals).toEqual([{ fromDate: '2025-07-01', throughDate: '2025-08-15' }])
    })

    it('keeps the raw assertions alongside the merged spans', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-06-01', throughDate: '2025-06-30', source: 'import', note: 'june.csv' })
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'reconcile' })

      const { intervals, assertions } = await (await getCoverage(cookie, acct.id)).json()

      expect(intervals).toHaveLength(1)
      expect(assertions).toHaveLength(2)
      expect(assertions.map((a: { source: string }) => a.source)).toEqual(['reconcile', 'import'])
      expect(assertions[1].note).toBe('june.csv')
      expect(assertions[0].id).toBeString()
    })

    it('scopes coverage to the account it was asserted against', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const visa = await createAccount(userId, 'liabilities:visa')
      await postCoverage(cookie, { accountId: chequing.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import' })

      const { intervals } = await (await getCoverage(cookie, visa.id)).json()

      expect(intervals).toEqual([])
    })

    it('refuses to read another user\'s coverage', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const otherUserId = await userIdFor(otherCookie)
      const theirAccount = await createAccount(otherUserId, 'assets:their-chequing')
      await postCoverage(otherCookie, { accountId: theirAccount.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import' })

      const res = await getCoverage(cookie, theirAccount.id)

      expect(res.status).toBe(404)
    })

    it('returns 404 rather than 500 for a malformed account id', async () => {
      const res = await getCoverage(cookie, 'not-a-uuid')

      expect(res.status).toBe(404)
    })

    it('requires authentication', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const res = await app.request(`/api/accounts/${acct.id}/coverage`)

      expect(res.status).toBe(401)
    })
  })

  describe('DELETE /api/coverage/:id', () => {
    it('soft deletes an assertion and drops it from the merged result', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      const created = await (await postCoverage(cookie, {
        accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import',
      })).json()

      const res = await app.request(`/api/coverage/${created.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
      expect(res.status).toBe(204)

      const { intervals, assertions } = await (await getCoverage(cookie, acct.id)).json()
      expect(intervals).toEqual([])
      expect(assertions).toEqual([])

      // The row survives — a withdrawn assertion is still a thing that was once asserted.
      const [row] = await db.select().from(accountCoverage).where(eq(accountCoverage.id, created.id))
      expect(row).toBeDefined()
      expect(row.deletedAt).not.toBeNull()
    })

    // Deleting the bridging assertion must reopen the gap it was covering.
    it('reopens a span when the interval joining it is withdrawn', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-06-01', throughDate: '2025-06-30', source: 'import' })
      const july = await (await postCoverage(cookie, {
        accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import',
      })).json()
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-08-01', throughDate: '2025-08-31', source: 'import' })

      const before = await (await getCoverage(cookie, acct.id)).json()
      expect(before.intervals).toEqual([{ fromDate: '2025-06-01', throughDate: '2025-08-31' }])

      await app.request(`/api/coverage/${july.id}`, { method: 'DELETE', headers: { Cookie: cookie } })

      const after = await (await getCoverage(cookie, acct.id)).json()
      expect(after.intervals).toEqual([
        { fromDate: '2025-08-01', throughDate: '2025-08-31' },
        { fromDate: '2025-06-01', throughDate: '2025-06-30' },
      ])
    })

    // An overlapping assertion still standing keeps the range covered — withdrawing one
    // claim is not the same as withdrawing the fact.
    it('leaves coverage intact when a duplicate assertion still stands', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      const first = await (await postCoverage(cookie, {
        accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import',
      })).json()
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'reconcile' })

      await app.request(`/api/coverage/${first.id}`, { method: 'DELETE', headers: { Cookie: cookie } })

      const { intervals } = await (await getCoverage(cookie, acct.id)).json()
      expect(intervals).toEqual([{ fromDate: '2025-07-01', throughDate: '2025-07-31' }])
    })

    it('refuses to delete another user\'s assertion', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const otherUserId = await userIdFor(otherCookie)
      const theirAccount = await createAccount(otherUserId, 'assets:their-chequing')
      const theirs = await (await postCoverage(otherCookie, {
        accountId: theirAccount.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import',
      })).json()

      await app.request(`/api/coverage/${theirs.id}`, { method: 'DELETE', headers: { Cookie: cookie } })

      const [row] = await db.select().from(accountCoverage).where(eq(accountCoverage.id, theirs.id))
      expect(row.deletedAt).toBeNull()
    })

    it('is idempotent', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      const created = await (await postCoverage(cookie, {
        accountId: acct.id, fromDate: '2025-07-01', throughDate: '2025-07-31', source: 'import',
      })).json()

      await app.request(`/api/coverage/${created.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
      const second = await app.request(`/api/coverage/${created.id}`, { method: 'DELETE', headers: { Cookie: cookie } })

      expect(second.status).toBe(204)
    })

    it('returns 204 rather than 500 for a malformed id', async () => {
      const res = await app.request('/api/coverage/not-a-uuid', { method: 'DELETE', headers: { Cookie: cookie } })

      expect(res.status).toBe(204)
    })

    it('requires authentication', async () => {
      const res = await app.request('/api/coverage/00000000-0000-4000-8000-000000000000', { method: 'DELETE' })

      expect(res.status).toBe(401)
    })
  })
})
