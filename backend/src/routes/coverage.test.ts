import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { accountCoverage, accounts, postings, transactions, userSettings } from '../db/schema'
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

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().substring(0, 10)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().substring(0, 10)
}

async function seedTxn(userId: string, accountId: string, date: string, offsetAccountId: string) {
  const [tx] = await db
    .insert(transactions)
    .values({ userId, date: new Date(`${date}T12:00:00Z`), description: 'test' })
    .returning()
  await db.insert(postings).values([
    { transactionId: tx.id, accountId, amount: '-10.00', currency: 'CAD' },
    { transactionId: tx.id, accountId: offsetAccountId, amount: '10.00', currency: 'CAD' },
  ])
  return tx
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
      expect(await res.json()).toMatchObject({ accountId: acct.id, intervals: [], assertions: [] })
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

    describe('the strip window', () => {
      it('defaults to the last 90 days ending today', async () => {
        const acct = await createAccount(userId, 'assets:chequing')

        const { window } = await (await getCoverage(cookie, acct.id)).json()

        expect(window).toEqual({ from: daysAgo(89), to: daysAgo(0), days: 90 })
      })

      it('honours an explicit day count', async () => {
        const acct = await createAccount(userId, 'assets:chequing')

        const res = await app.request(`/api/accounts/${acct.id}/coverage?days=30`, { headers: { Cookie: cookie } })

        expect((await res.json()).window).toEqual({ from: daysAgo(29), to: daysAgo(0), days: 30 })
      })

      it('clamps an oversized window rather than drawing an unreadable strip', async () => {
        const acct = await createAccount(userId, 'assets:chequing')

        const res = await app.request(`/api/accounts/${acct.id}/coverage?days=99999`, { headers: { Cookie: cookie } })

        expect((await res.json()).window.days).toBe(730)
      })

      // A read-only view should render over a query-string typo, not 400.
      it('falls back to the default on a nonsense day count', async () => {
        const acct = await createAccount(userId, 'assets:chequing')

        for (const days of ['banana', '0', '-5', '12.5', '']) {
          const res = await app.request(`/api/accounts/${acct.id}/coverage?days=${days}`, { headers: { Cookie: cookie } })
          expect((await res.json()).window.days).toBe(90)
        }
      })
    })

    describe('transaction dates', () => {
      it('reports the days inside the window that have transactions', async () => {
        const acct = await createAccount(userId, 'assets:chequing')
        const groceries = await createAccount(userId, 'expenses:groceries')
        await seedTxn(userId, acct.id, daysAgo(40), groceries.id)
        await seedTxn(userId, acct.id, daysAgo(10), groceries.id)

        const { txnDates } = await (await getCoverage(cookie, acct.id)).json()

        expect(txnDates).toEqual([daysAgo(40), daysAgo(10)])
      })

      // One tick per day — the strip draws days, not transactions.
      it('collapses several transactions on one day to a single date', async () => {
        const acct = await createAccount(userId, 'assets:chequing')
        const groceries = await createAccount(userId, 'expenses:groceries')
        await seedTxn(userId, acct.id, daysAgo(5), groceries.id)
        await seedTxn(userId, acct.id, daysAgo(5), groceries.id)
        await seedTxn(userId, acct.id, daysAgo(5), groceries.id)

        const { txnDates } = await (await getCoverage(cookie, acct.id)).json()

        expect(txnDates).toEqual([daysAgo(5)])
      })

      it('excludes transactions outside the window', async () => {
        const acct = await createAccount(userId, 'assets:chequing')
        const groceries = await createAccount(userId, 'expenses:groceries')
        await seedTxn(userId, acct.id, daysAgo(200), groceries.id)
        await seedTxn(userId, acct.id, daysAgo(3), groceries.id)

        const { txnDates } = await (await getCoverage(cookie, acct.id)).json()

        expect(txnDates).toEqual([daysAgo(3)])
      })

      it('includes the transactions on the window edges', async () => {
        const acct = await createAccount(userId, 'assets:chequing')
        const groceries = await createAccount(userId, 'expenses:groceries')
        await seedTxn(userId, acct.id, daysAgo(89), groceries.id)
        await seedTxn(userId, acct.id, daysAgo(0), groceries.id)

        const { txnDates } = await (await getCoverage(cookie, acct.id)).json()

        expect(txnDates).toEqual([daysAgo(89), daysAgo(0)])
      })

      it('ignores another account\'s transactions', async () => {
        const acct = await createAccount(userId, 'assets:chequing')
        const other = await createAccount(userId, 'liabilities:visa')
        const groceries = await createAccount(userId, 'expenses:groceries')
        await seedTxn(userId, other.id, daysAgo(10), groceries.id)

        const { txnDates } = await (await getCoverage(cookie, acct.id)).json()

        expect(txnDates).toEqual([])
      })

      it('ignores soft-deleted transactions', async () => {
        const acct = await createAccount(userId, 'assets:chequing')
        const groceries = await createAccount(userId, 'expenses:groceries')
        const tx = await seedTxn(userId, acct.id, daysAgo(10), groceries.id)
        await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, tx.id))

        const { txnDates } = await (await getCoverage(cookie, acct.id)).json()

        expect(txnDates).toEqual([])
      })
    })
  })

  describe('POST /api/coverage/reconcile', () => {
    async function reconcile(cookieValue: string, body: Record<string, unknown>) {
      return app.request('/api/coverage/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieValue },
        body: JSON.stringify(body),
      })
    }

    // A balanced reconcile posts no adjustment, but it is still proof the ledger matched.
    // That evidence is exactly what this records.
    it('continues coverage from where it left off', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-05-01', throughDate: '2025-06-30', source: 'import' })

      const res = await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.created).toBe(true)
      expect(body.interval).toMatchObject({
        fromDate: '2025-07-01',
        throughDate: '2025-07-31',
        source: 'reconcile',
      })
    })

    it('leaves no seam between the old span and the new one', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-05-01', throughDate: '2025-06-30', source: 'import' })
      await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })

      const { intervals } = await (await getCoverage(cookie, acct.id)).json()

      expect(intervals).toEqual([{ fromDate: '2025-05-01', throughDate: '2025-07-31' }])
    })

    // Everything before an account's first transaction is vacuously complete.
    it('starts at the first transaction when there is no coverage yet', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      const groceries = await createAccount(userId, 'expenses:groceries')
      await seedTxn(userId, acct.id, '2025-03-14', groceries.id)
      await seedTxn(userId, acct.id, '2025-06-02', groceries.id)

      const body = await (await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })).json()

      expect(body.interval).toMatchObject({ fromDate: '2025-03-14', throughDate: '2025-07-31' })
    })

    it('speaks only for the reconcile date when the account has no history at all', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      const body = await (await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })).json()

      expect(body.interval).toMatchObject({ fromDate: '2025-07-31', throughDate: '2025-07-31' })
    })

    // A first transaction dated after the reconcile date would otherwise produce an inverted
    // range that the check constraint rejects.
    it('clamps rather than inverting when the history starts after the date', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      const groceries = await createAccount(userId, 'expenses:groceries')
      await seedTxn(userId, acct.id, '2025-09-01', groceries.id)

      const body = await (await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })).json()

      expect(body.interval).toMatchObject({ fromDate: '2025-07-31', throughDate: '2025-07-31' })
    })

    it('walks over an older hole rather than trying to fill it', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-01-01', throughDate: '2025-01-31', source: 'import' })
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-05-01', throughDate: '2025-06-30', source: 'import' })

      const body = await (await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })).json()

      expect(body.interval).toMatchObject({ fromDate: '2025-07-01' })

      const { intervals } = await (await getCoverage(cookie, acct.id)).json()
      expect(intervals).toEqual([
        { fromDate: '2025-05-01', throughDate: '2025-07-31' },
        { fromDate: '2025-01-01', throughDate: '2025-01-31' },
      ])
    })

    it('writes nothing when coverage already reaches past the date', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-05-01', throughDate: '2025-08-31', source: 'import' })

      const res = await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ created: false, coveredThrough: '2025-08-31' })

      const { assertions } = await (await getCoverage(cookie, acct.id)).json()
      expect(assertions).toHaveLength(1)
    })

    it('writes nothing when coverage already reaches exactly the date', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, { accountId: acct.id, fromDate: '2025-05-01', throughDate: '2025-07-31', source: 'import' })

      expect((await (await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })).json()).created)
        .toBe(false)
    })

    it('ignores another account\'s transactions when picking the start', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      const other = await createAccount(userId, 'liabilities:visa')
      const groceries = await createAccount(userId, 'expenses:groceries')
      await seedTxn(userId, other.id, '2025-01-05', groceries.id)
      await seedTxn(userId, acct.id, '2025-06-02', groceries.id)

      const body = await (await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })).json()

      expect(body.interval.fromDate).toBe('2025-06-02')
    })

    it('ignores soft-deleted transactions when picking the start', async () => {
      const acct = await createAccount(userId, 'assets:chequing')
      const groceries = await createAccount(userId, 'expenses:groceries')
      const old = await seedTxn(userId, acct.id, '2025-01-05', groceries.id)
      await seedTxn(userId, acct.id, '2025-06-02', groceries.id)
      await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, old.id))

      const body = await (await reconcile(cookie, { accountId: acct.id, throughDate: '2025-07-31' })).json()

      expect(body.interval.fromDate).toBe('2025-06-02')
    })

    it('refuses to reconcile another user\'s account', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const theirUserId = await (async () => {
        const r = await app.request('/api/auth/get-session', { headers: { Cookie: otherCookie } })
        return (await r.json()).user.id as string
      })()
      const theirAccount = await createAccount(theirUserId, 'assets:theirs')

      const res = await reconcile(cookie, { accountId: theirAccount.id, throughDate: '2025-07-31' })

      expect(res.status).toBe(404)
      const rows = await db.select().from(accountCoverage).where(eq(accountCoverage.accountId, theirAccount.id))
      expect(rows).toHaveLength(0)
    })

    it('rejects a malformed date', async () => {
      const acct = await createAccount(userId, 'assets:chequing')

      expect((await reconcile(cookie, { accountId: acct.id, throughDate: '31/07/2025' })).status).toBe(400)
      expect((await reconcile(cookie, { accountId: acct.id })).status).toBe(400)
    })

    it('requires authentication', async () => {
      const res = await app.request('/api/coverage/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: '00000000-0000-4000-8000-000000000000', throughDate: '2025-07-31' }),
      })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/coverage/accounts', () => {
    const projection = async () => {
      const res = await app.request('/api/coverage/accounts', { headers: { Cookie: cookie } })
      return { status: res.status, body: await res.json() }
    }

    const catchUp = async () => {
      const res = await app.request('/api/catch-up', { headers: { Cookie: cookie } })
      return res.json()
    }

    // The whole reason both endpoints go through one loader. If this ever fails, the accounts
    // page and the coach are describing the same account differently on the same screen.
    it('agrees with catch-up on every account, for a fixture of every state', async () => {
      const groceries = await createAccount(userId, 'expenses:groceries')
      // Behind: covered to a month ago, still transacting.
      const chequing = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(400), throughDate: daysAgo(30), source: 'import',
      })
      await seedTxn(userId, chequing.id, daysAgo(35), groceries.id)
      // Current: covered right up to today.
      const wise = await createAccount(userId, 'assets:wise')
      await postCoverage(cookie, {
        accountId: wise.id, fromDate: daysAgo(90), throughDate: daysAgo(0), source: 'import',
      })
      await seedTxn(userId, wise.id, daysAgo(5), groceries.id)
      // Dormant: a long confirmed-empty stretch and nothing since.
      const oldSavings = await createAccount(userId, 'assets:old-savings')
      await postCoverage(cookie, {
        accountId: oldSavings.id, fromDate: daysAgo(300), throughDate: daysAgo(60), source: 'empty',
      })
      // Unset: never asserted at all.
      await createAccount(userId, 'assets:cash')
      // Neither of these is a contributor, and neither endpoint should list them.
      await createAccount(userId, 'assets:receivable:trip')
      const hidden = await createAccount(userId, 'assets:hidden')
      await db.update(userSettings)
        .set({ preferences: { hiddenAccountIds: [hidden.id] } })
        .where(eq(userSettings.userId, userId))

      const { status, body } = await projection()
      const coach = await catchUp()

      expect(status).toBe(200)
      expect(body.today).toBe(coach.today)
      const shrink = (a: any) => ({
        accountId: a.accountId, state: a.state, coveredThrough: a.coveredThrough, dormant: a.dormant,
      })
      const byId = (rows: any[]) => [...rows].sort((a, b) => a.accountId.localeCompare(b.accountId))
      expect(byId(body.accounts)).toEqual(byId(coach.accounts.map(shrink)))
      // Not a tautology on an empty list: the fixture has to actually reach every branch.
      const states = new Set(body.accounts.map((a: any) => a.state))
      expect(states).toEqual(new Set(['behind', 'current', 'unset']))
      expect(body.accounts.filter((a: any) => a.dormant)).toHaveLength(1)
    })

    it('carries the leading edge as the completeness date of a behind account', async () => {
      const groceries = await createAccount(userId, 'expenses:groceries')
      const chequing = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(120), throughDate: daysAgo(74), source: 'import',
      })
      // Without activity inside the covered span the account reads dormant, which is correct
      // and not what this test is about.
      await seedTxn(userId, chequing.id, daysAgo(80), groceries.id)

      const { body } = await projection()

      expect(body.accounts).toEqual([
        { accountId: chequing.id, state: 'behind', coveredThrough: daysAgo(74), dormant: false },
      ])
    })

    // The trap this endpoint exists to avoid: an account nobody has ever asserted coverage for
    // knows nothing, and "knows nothing" must never serialize as "up to date".
    it('reports an account with no coverage as unset, not current', async () => {
      const cash = await createAccount(userId, 'assets:cash')

      const { body } = await projection()

      expect(body.accounts).toEqual([
        { accountId: cash.id, state: 'unset', coveredThrough: null, dormant: false },
      ])
    })

    it('ships none of the strip and interval weight the coach payload carries', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(120), throughDate: daysAgo(74), source: 'import',
      })

      const { body } = await projection()

      expect(Object.keys(body.accounts[0]).sort()).toEqual([
        'accountId', 'coveredThrough', 'dormant', 'state',
      ])
    })

    it('sees only the caller\'s own accounts', async () => {
      await createAccount(userId, 'assets:chequing')
      const otherCookie = await createTestUser('other@example.com')
      const otherId = await userIdFor(otherCookie)
      await createAccount(otherId, 'assets:theirs')

      const { body } = await projection()

      expect(body.accounts).toHaveLength(1)
    })

    it('requires authentication', async () => {
      const res = await app.request('/api/coverage/accounts')

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/coverage/months', () => {
    const months = async (from: string, to: string) => {
      const res = await app.request(`/api/coverage/months?from=${from}&to=${to}`, {
        headers: { Cookie: cookie },
      })
      return { status: res.status, body: await res.json() }
    }

    const today = () => new Date().toISOString().substring(0, 10)
    const monthOf = (iso: string) => iso.substring(0, 7)

    it('calls a month complete when every tracked account covers all of it', async () => {
      const groceries = await createAccount(userId, 'expenses:groceries')
      const chequing = await createAccount(userId, 'assets:chequing')
      const visa = await createAccount(userId, 'liabilities:visa')
      for (const id of [chequing.id, visa.id]) {
        await postCoverage(cookie, {
          accountId: id, fromDate: daysAgo(400), throughDate: today(), source: 'import',
        })
        // Activity inside the covered span, or the account reads dormant and drops out of the
        // reckoning entirely — which is correct behaviour and not what this test is about.
        await seedTxn(userId, id, daysAgo(120), groceries.id)
      }

      const { status, body } = await months(monthOf(daysAgo(120)), monthOf(daysAgo(120)))

      expect(status).toBe(200)
      expect(body.months[0].state).toBe('complete')
      expect(body.months[0].gaps).toEqual([])
    })

    it('names the accounts that fall short of a partial month', async () => {
      const groceries = await createAccount(userId, 'expenses:groceries')
      const chequing = await createAccount(userId, 'assets:chequing')
      const visa = await createAccount(userId, 'liabilities:visa')
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(400), throughDate: daysAgo(1), source: 'import',
      })
      await postCoverage(cookie, {
        accountId: visa.id, fromDate: daysAgo(400), throughDate: daysAgo(90), source: 'import',
      })
      await seedTxn(userId, chequing.id, daysAgo(10), groceries.id)
      await seedTxn(userId, visa.id, daysAgo(120), groceries.id)

      // The month the visa's coverage stops inside.
      const { body } = await months(monthOf(daysAgo(90)), monthOf(daysAgo(90)))

      expect(body.months[0].state).toBe('partial')
      expect(body.months[0].completeThrough).toBe(daysAgo(90))
      expect(body.months[0].gaps).toEqual([
        { accountId: visa.id, path: 'liabilities:visa', name: null, coveredThrough: daysAgo(90) },
      ])
    })

    // The reason this endpoint exists rather than the accounts projection answering it: an
    // account covered either side of a hole has a recent leading edge and an unrecorded month.
    it('sees a month sitting in a hole behind a recent leading edge', async () => {
      const groceries = await createAccount(userId, 'expenses:groceries')
      const chequing = await createAccount(userId, 'assets:chequing')
      // Two spans with a whole calendar month missing between them. The leading edge is today.
      const [hole] = [monthOf(daysAgo(60))]
      const holeStart = `${hole}-01`
      const holeEnd = `${hole}-${new Date(Date.UTC(+hole.slice(0, 4), +hole.slice(5, 7), 0)).getUTCDate()}`
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(400), throughDate: addDays(holeStart, -1), source: 'import',
      })
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: addDays(holeEnd, 1), throughDate: today(), source: 'import',
      })
      await seedTxn(userId, chequing.id, daysAgo(10), groceries.id)

      const { body } = await months(monthOf(addDays(holeStart, -1)), monthOf(addDays(holeEnd, 1)))

      expect(body.months.map((m: any) => m.state)).toEqual(['complete', 'uncovered', 'complete'])
    })

    // Same rule as a rollup's as-of: an account confirmed empty contributes nothing, so being
    // unrecorded for it cannot make a month's total wrong.
    it('does not let a dormant account hold a month back', async () => {
      const groceries = await createAccount(userId, 'expenses:groceries')
      const chequing = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(400), throughDate: today(), source: 'import',
      })
      await seedTxn(userId, chequing.id, daysAgo(10), groceries.id)
      // Long confirmed-empty history and nothing since: dormant.
      const oldSavings = await createAccount(userId, 'assets:old-savings')
      await postCoverage(cookie, {
        accountId: oldSavings.id, fromDate: daysAgo(300), throughDate: daysAgo(200), source: 'empty',
      })

      const { body } = await months(monthOf(daysAgo(30)), monthOf(daysAgo(30)))

      expect(body.months[0].state).toBe('complete')
      expect(body.months[0].contributors).toBe(1)
    })

    it('measures the month in progress against today rather than its end', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(400), throughDate: today(), source: 'import',
      })

      const { body } = await months(monthOf(today()), monthOf(today()))

      expect(body.months[0].state).toBe('complete')
      expect(body.months[0].through).toBe(today())
    })

    it('reports no contributors when nothing is tracked', async () => {
      await createAccount(userId, 'expenses:groceries')

      const { body } = await months('2026-06', '2026-06')

      expect(body.months[0].contributors).toBe(0)
    })

    it('walks the whole inclusive range', async () => {
      const { body } = await months('2026-05', '2026-07')

      expect(body.months.map((m: any) => m.month)).toEqual(['2026-05', '2026-06', '2026-07'])
    })

    // A user who has never used the coverage feature gets every month back as uncovered,
    // which is true and useless. The count is how a caller knows to say nothing at all rather
    // than report that none of their spending is recorded.
    it('reports that no account has ever asserted coverage', async () => {
      await createAccount(userId, 'assets:chequing')

      const { body } = await months('2026-06', '2026-06')

      expect(body.assertedAccounts).toBe(0)
      expect(body.months[0].state).toBe('uncovered')
    })

    it('counts the accounts that have asserted coverage', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await createAccount(userId, 'assets:cash')
      await postCoverage(cookie, {
        accountId: chequing.id, fromDate: daysAgo(400), throughDate: today(), source: 'import',
      })

      const { body } = await months('2026-06', '2026-06')

      expect(body.assertedAccounts).toBe(1)
    })

    it('rejects a malformed month', async () => {
      const { status } = await months('2026-13', '2026-13')

      expect(status).toBe(400)
    })

    it('rejects an inverted range', async () => {
      const { status } = await months('2026-09', '2026-07')

      expect(status).toBe(400)
    })

    it('rejects a range longer than it will classify', async () => {
      const { status } = await months('2020-01', '2026-09')

      expect(status).toBe(400)
    })

    it('requires authentication', async () => {
      const res = await app.request('/api/coverage/months?from=2026-09&to=2026-09')

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
