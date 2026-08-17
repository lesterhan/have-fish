import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { transactions, expenseGroups, expenseGroupMembers, groupExpenses } from '../db/schema'
import { eq } from 'drizzle-orm'

describe('transactions', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET /api/transactions returns an empty array when there are no transactions', async () => {
    const res = await app.request('/api/transactions', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('GET /api/transactions attaches accountPath and a derived role to each posting', async () => {
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, food] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
    ])
    await app.request('/api/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [
        { accountId: chequing.id, amount: '-10.00', currency: 'CAD' },
        { accountId: food.id, amount: '10.00', currency: 'CAD' },
      ] }),
    })

    const res = await app.request('/api/transactions', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    type P = { accountId: string; accountPath: string; role: string }
    const body = await res.json() as { postings: P[] }[]
    const ps = body[0].postings
    const byAccount = Object.fromEntries(ps.map(p => [p.accountId, p]))
    expect(byAccount[chequing.id].accountPath).toBe('assets:chequing')
    expect(byAccount[chequing.id].role).toBe('transfer')
    expect(byAccount[food.id].accountPath).toBe('expenses:food')
    expect(byAccount[food.id].role).toBe('subject')
  })

  it('GET /api/transactions exposes each posting accountName (null when unset, the name when set)', async () => {
    // The friendly label resolver (story 2) needs accounts.name on the read payload; it is
    // null until the user names the account, then carries the name they set.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, food] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
    ])
    // Name only one of the two accounts.
    await app.request(`/api/accounts/${food.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Eating Out' }) })
    await app.request('/api/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [
        { accountId: chequing.id, amount: '-10.00', currency: 'CAD' },
        { accountId: food.id, amount: '10.00', currency: 'CAD' },
      ] }),
    })

    const res = await app.request('/api/transactions', { headers: { Cookie: cookie } })
    type P = { accountId: string; accountName: string | null }
    const body = await res.json() as { postings: P[] }[]
    const byAccount = Object.fromEntries(body[0].postings.map(p => [p.accountId, p]))
    expect(byAccount[food.id].accountName).toBe('Eating Out')
    expect(byAccount[chequing.id].accountName).toBeNull()
  })

  it('POST /api/transactions returns postings enriched with accountName', async () => {
    // The create response must match the GET payload shape — accountName included — so a
    // freshly-created row narrates without a refetch.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, food] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
    ])
    await app.request(`/api/accounts/${food.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Eating Out' }) })
    const res = await app.request('/api/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [
        { accountId: chequing.id, amount: '-10.00', currency: 'CAD' },
        { accountId: food.id, amount: '10.00', currency: 'CAD' },
      ] }),
    })
    expect(res.status).toBe(201)
    type P = { accountId: string; accountName: string | null }
    const body = await res.json() as { postings: P[] }
    const byAccount = Object.fromEntries(body.postings.map(p => [p.accountId, p]))
    expect(byAccount[food.id].accountName).toBe('Eating Out')
    expect(byAccount[chequing.id].accountName).toBeNull()
  })

  it('POST /api/transactions returns postings enriched with accountPath and role', async () => {
    // The create response must match the GET payload shape so a freshly-created row can be
    // narrated (TransactionDetail) without a refetch.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, food] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
    ])
    const res = await app.request('/api/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [
        { accountId: chequing.id, amount: '-10.00', currency: 'CAD' },
        { accountId: food.id, amount: '10.00', currency: 'CAD' },
      ] }),
    })
    expect(res.status).toBe(201)
    type P = { accountId: string; accountPath: string; role: string }
    const body = await res.json() as { postings: P[] }
    const byAccount = Object.fromEntries(body.postings.map(p => [p.accountId, p]))
    expect(byAccount[chequing.id].accountPath).toBe('assets:chequing')
    expect(byAccount[chequing.id].role).toBe('transfer')
    expect(byAccount[food.id].accountPath).toBe('expenses:food')
    expect(byAccount[food.id].role).toBe('subject')
  })

  it('POST /api/transactions/bulk returns each transaction with enriched postings', async () => {
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, food] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
    ])
    const res = await app.request('/api/transactions/bulk', {
      method: 'POST', headers,
      body: JSON.stringify({ transactions: [
        { date: '2026-03-01', description: 'A', postings: [
          { accountId: chequing.id, amount: '-10.00', currency: 'CAD' },
          { accountId: food.id, amount: '10.00', currency: 'CAD' },
        ] },
        { date: '2026-03-02', description: 'B', postings: [
          { accountId: chequing.id, amount: '-20.00', currency: 'CAD' },
          { accountId: food.id, amount: '20.00', currency: 'CAD' },
        ] },
      ] }),
    })
    expect(res.status).toBe(201)
    type P = { accountId: string; accountPath: string; role: string }
    const body = await res.json() as { postings: P[] }[]
    expect(body).toHaveLength(2)
    // Roles must be attached per-transaction, not bled across the flattened batch.
    for (const tx of body) {
      const byAccount = Object.fromEntries(tx.postings.map(p => [p.accountId, p]))
      expect(byAccount[chequing.id].role).toBe('transfer')
      expect(byAccount[food.id].role).toBe('subject')
      expect(byAccount[food.id].accountPath).toBe('expenses:food')
    }
  })

  it('POST /api/transactions rejects a posting referencing another user\'s account', async () => {
    // Account ownership guard: a user must not be able to create a posting against — or leak
    // the path of — an account they don't own.
    const otherCookie = await createTestUser('other@example.com')
    const otherHeaders = { Cookie: otherCookie, 'Content-Type': 'application/json' }
    const foreign = await app
      .request('/api/accounts', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ path: 'assets:secret' }) })
      .then(r => r.json())

    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const mine = await app
      .request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) })
      .then(r => r.json())

    const res = await app.request('/api/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({ date: '2026-03-01', description: 'x', postings: [
        { accountId: foreign.id, amount: '-10.00', currency: 'CAD' },
        { accountId: mine.id, amount: '10.00', currency: 'CAD' },
      ] }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('One or more accounts not found')

    // Nothing was created.
    const list = await app.request('/api/transactions', { headers: { Cookie: cookie } }).then(r => r.json())
    expect(list).toHaveLength(0)
  })

  it('POST /api/transactions/bulk rejects a foreign account in any transaction', async () => {
    const otherCookie = await createTestUser('other@example.com')
    const otherHeaders = { Cookie: otherCookie, 'Content-Type': 'application/json' }
    const foreign = await app
      .request('/api/accounts', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ path: 'assets:secret' }) })
      .then(r => r.json())

    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, food] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
    ])

    const res = await app.request('/api/transactions/bulk', {
      method: 'POST', headers,
      body: JSON.stringify({ transactions: [
        { date: '2026-03-01', description: 'ok', postings: [
          { accountId: chequing.id, amount: '-10.00', currency: 'CAD' },
          { accountId: food.id, amount: '10.00', currency: 'CAD' },
        ] },
        { date: '2026-03-02', description: 'bad', postings: [
          { accountId: foreign.id, amount: '-20.00', currency: 'CAD' },
          { accountId: food.id, amount: '20.00', currency: 'CAD' },
        ] },
      ] }),
    })
    expect(res.status).toBe(404)
    // Atomic: the valid transaction in the same batch must not have been created either.
    const list = await app.request('/api/transactions', { headers: { Cookie: cookie } }).then(r => r.json())
    expect(list).toHaveLength(0)
  })

  describe('PATCH /api/transactions/:id', () => {
    let txId: string
    const headers = { Cookie: '', 'Content-Type': 'application/json' }

    beforeEach(async () => {
      headers.Cookie = cookie
      const [accA, accB] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
      ])
      const tx = await app.request('/api/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({ date: '2026-03-01', description: 'Lunch', postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      }).then(r => r.json())
      txId = tx.id
    })

    it('updates description', async () => {
      const res = await app.request(`/api/transactions/${txId}`, { method: 'PATCH', headers, body: JSON.stringify({ description: 'Dinner' }) })
      expect(res.status).toBe(200)
      expect((await res.json()).description).toBe('Dinner')
    })

    it('updates date', async () => {
      const res = await app.request(`/api/transactions/${txId}`, { method: 'PATCH', headers, body: JSON.stringify({ date: '2026-04-01' }) })
      expect(res.status).toBe(200)
      expect((await res.json()).date).toContain('2026-04-01')
    })

    it('returns 404 for unknown id', async () => {
      const res = await app.request('/api/transactions/00000000-0000-0000-0000-000000000000', { method: 'PATCH', headers, body: JSON.stringify({ description: 'x' }) })
      expect(res.status).toBe(404)
    })

    it('returns 404 for another user\'s transaction', async () => {
      const otherCookie = await createTestUser('other@example.com', 'password123')
      const res = await app.request(`/api/transactions/${txId}`, { method: 'PATCH', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ description: 'x' }) })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/transactions/:id/postings', () => {
    let txId: string
    let accA: { id: string }, accB: { id: string }, accC: { id: string }
    const headers = { Cookie: '', 'Content-Type': 'application/json' }

    beforeEach(async () => {
      headers.Cookie = cookie
      ;[accA, accB, accC] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:transport', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
      ])
      const tx = await app.request('/api/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({ date: '2026-03-01', description: 'Test', postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      }).then(r => r.json())
      txId = tx.id
    })

    it('replaces all postings on a transaction', async () => {
      // Split the expense across two accounts — old postings are fully replaced
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '6.00', currency: 'CAD' }, { accountId: accC.id, amount: '4.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.postings).toHaveLength(3)
      // Replaced postings are enriched with accountPath + role like the GET payload.
      const byAccount = Object.fromEntries(body.postings.map((p: { accountId: string }) => [p.accountId, p]))
      expect(byAccount[accA.id].accountPath).toBe('assets:chequing')
      expect(byAccount[accA.id].role).toBe('transfer')
      expect(byAccount[accC.id].role).toBe('subject')
    })

    it('recategorizes the subject leg (same amounts) without unbalancing', async () => {
      // Smart edit repoints only the expense leg's account (food → transport). Amounts are
      // unchanged, so the entry still balances; the backend re-validates regardless.
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accC.id, amount: '10.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.postings).toHaveLength(2)
      const accountIds = body.postings.map((p: { accountId: string }) => p.accountId).sort()
      // The food leg is gone, transport is in; the bank leg is untouched.
      expect(accountIds).toEqual([accA.id, accC.id].sort())
      const subject = body.postings.find((p: { role: string }) => p.role === 'subject')
      expect(subject.accountId).toBe(accC.id)
      expect(subject.amount).toBe('10.00')
    })

    it('returns 400 when postings do not balance', async () => {
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '5.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when fewer than 2 postings are provided', async () => {
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '0.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown transaction id', async () => {
      const res = await app.request('/api/transactions/00000000-0000-0000-0000-000000000000/postings', {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(404)
    })

    it("returns 404 when an account belongs to another user", async () => {
      const otherCookie = await createTestUser('other@example.com', 'password123')
      const otherHeaders = { ...headers, Cookie: otherCookie }
      const otherAcc = await app.request('/api/accounts', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json())
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers,
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: otherAcc.id, amount: '10.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(404)
    })

    it("returns 404 for another user's transaction", async () => {
      const otherCookie = await createTestUser('other@example.com', 'password123')
      const res = await app.request(`/api/transactions/${txId}/postings`, {
        method: 'POST', headers: { ...headers, Cookie: otherCookie },
        body: JSON.stringify({ postings: [{ accountId: accA.id, amount: '-10.00', currency: 'CAD' }, { accountId: accB.id, amount: '10.00', currency: 'CAD' }] }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/transactions date filtering', () => {
    // Seed two accounts and two transactions on distinct dates before each test.
    // Transaction A: 2026-01-15, Transaction B: 2026-03-01
    beforeEach(async () => {
      const headersJson = { Cookie: cookie, 'Content-Type': 'application/json' }

      const [accA, accB] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers: headersJson, body: JSON.stringify({ path: 'assets:chequing', type: 'asset', currency: 'CAD' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers: headersJson, body: JSON.stringify({ path: 'expenses:food', type: 'expense', currency: 'CAD' }) }).then(r => r.json()),
      ])

      const posting = (accountId: string, amount: string) => ({ accountId, amount, currency: 'CAD' })

      await Promise.all([
        app.request('/api/transactions', { method: 'POST', headers: headersJson, body: JSON.stringify({ date: '2026-01-15', description: 'January tx', postings: [posting(accA.id, '-10.00'), posting(accB.id, '10.00')] }) }),
        app.request('/api/transactions', { method: 'POST', headers: headersJson, body: JSON.stringify({ date: '2026-03-01', description: 'March tx', postings: [posting(accA.id, '-20.00'), posting(accB.id, '20.00')] }) }),
      ])
    })

    it('returns only transactions within the given date range', async () => {
      const res = await app.request('/api/transactions?from=2026-01-01&to=2026-01-31', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].description).toBe('January tx')
    })

    it('returns transactions on or after ?from', async () => {
      const res = await app.request('/api/transactions?from=2026-02-01', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].description).toBe('March tx')
    })

    it('returns transactions on or before ?to', async () => {
      const res = await app.request('/api/transactions?to=2026-01-31', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].description).toBe('January tx')
    })

    it('returns empty array when date range matches nothing', async () => {
      const res = await app.request('/api/transactions?from=2025-01-01&to=2025-12-31', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it('returns all transactions when no date params are given', async () => {
      const res = await app.request('/api/transactions', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      expect(await res.json()).toHaveLength(2)
    })
  })

  describe('GET /api/transactions account filtering', () => {
    const headers = () => ({ Cookie: cookie, 'Content-Type': 'application/json' })
    const posting = (accountId: string, amount: string) => ({ accountId, amount, currency: 'CAD' })
    let chequing: { id: string }, savings: { id: string }
    let food: { id: string }, restaurant: { id: string }, rent: { id: string }

    // Two balance accounts and a three-account expense tree:
    //   expenses:food, expenses:food:restaurant, expenses:rent
    // Lunch  (2026-04-01) → chequing + food:restaurant
    // Market (2026-04-02) → savings  + food
    // Rent   (2026-04-03) → chequing + rent
    beforeEach(async () => {
      const h = headers()
      const mk = (path: string) =>
        app.request('/api/accounts', { method: 'POST', headers: h, body: JSON.stringify({ path }) }).then(r => r.json())
      ;[chequing, savings, food, restaurant, rent] = await Promise.all([
        mk('assets:chequing'), mk('assets:savings'),
        mk('expenses:food'), mk('expenses:food:restaurant'), mk('expenses:rent'),
      ])
      const tx = (date: string, description: string, a: string, b: string) =>
        app.request('/api/transactions', {
          method: 'POST', headers: h,
          body: JSON.stringify({ date, description, postings: [posting(a, '-10.00'), posting(b, '10.00')] }),
        })
      await tx('2026-04-01', 'Lunch', chequing.id, restaurant.id)
      await tx('2026-04-02', 'Market', savings.id, food.id)
      await tx('2026-04-03', 'Rent', chequing.id, rent.id)
    })

    const descriptions = async (qs: string) => {
      const res = await app.request(`/api/transactions?${qs}`, { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      return ((await res.json()) as { description: string }[]).map(t => t.description).sort()
    }

    it('?accountId returns only transactions with a posting to that exact account', async () => {
      expect(await descriptions(`accountId=${chequing.id}`)).toEqual(['Lunch', 'Rent'])
      expect(await descriptions(`accountId=${savings.id}`)).toEqual(['Market'])
    })

    it('?accountId does not match on a descendant account', async () => {
      // food and food:restaurant are distinct accounts — the id filter is exact.
      expect(await descriptions(`accountId=${food.id}`)).toEqual(['Market'])
    })

    it('?accountPath matches the account and all of its descendants', async () => {
      expect(await descriptions('accountPath=expenses:food')).toEqual(['Lunch', 'Market'])
      expect(await descriptions('accountPath=expenses:food:restaurant')).toEqual(['Lunch'])
      expect(await descriptions('accountPath=expenses')).toEqual(['Lunch', 'Market', 'Rent'])
    })

    it('combines an account filter with the date range', async () => {
      expect(await descriptions(`accountId=${chequing.id}&from=2026-04-02`)).toEqual(['Rent'])
      expect(await descriptions('accountPath=expenses&to=2026-04-01')).toEqual(['Lunch'])
    })

    it('returns an empty array for an account with no postings', async () => {
      const empty = await app
        .request('/api/accounts', { method: 'POST', headers: headers(), body: JSON.stringify({ path: 'assets:mattress' }) })
        .then(r => r.json())
      expect(await descriptions(`accountId=${empty.id}`)).toEqual([])
      expect(await descriptions('accountPath=assets:mattress')).toEqual([])
    })

    it('returns an empty array for an unknown accountPath', async () => {
      expect(await descriptions('accountPath=expenses:nope')).toEqual([])
    })

    it('treats LIKE metacharacters in accountPath as literals', async () => {
      // '_' and '%' must not act as wildcards — 'expenses:foo_' would otherwise
      // match 'expenses:food' and broaden the filter.
      expect(await descriptions('accountPath=expenses:foo_')).toEqual([])
      expect(await descriptions('accountPath=expenses:%')).toEqual([])
      expect(await descriptions('accountPath=%')).toEqual([])
    })

    it('does not match another user\'s account', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const otherHeaders = { Cookie: otherCookie, 'Content-Type': 'application/json' }
      const otherAcc = await app
        .request('/api/accounts', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ path: 'assets:chequing' }) })
        .then(r => r.json())
      const otherFood = await app
        .request('/api/accounts', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ path: 'expenses:food' }) })
        .then(r => r.json())
      await app.request('/api/transactions', {
        method: 'POST', headers: otherHeaders,
        body: JSON.stringify({ date: '2026-04-01', description: 'Their lunch', postings: [posting(otherAcc.id, '-99.00'), posting(otherFood.id, '99.00')] }),
      })

      // Filtering by the other user's account id returns nothing — the scan is scoped to
      // our own transactions, so their matching posting is invisible.
      expect(await descriptions(`accountId=${otherAcc.id}`)).toEqual([])
      // A shared path resolves to our account only, never theirs.
      expect(await descriptions('accountPath=expenses:food')).toEqual(['Lunch', 'Market'])
    })

    it('ignores postings on a soft-deleted account when filtering by path', async () => {
      await app.request(`/api/accounts/${rent.id}`, { method: 'DELETE', headers: headers() })
      expect(await descriptions('accountPath=expenses:rent')).toEqual([])
      // The rest of the tree is unaffected.
      expect(await descriptions('accountPath=expenses')).toEqual(['Lunch', 'Market'])
    })
  })

  describe('POST /api/transactions/bulk', () => {
    const headers = { Cookie: '', 'Content-Type': 'application/json' }
    let accA: { id: string }, accB: { id: string }

    beforeEach(async () => {
      headers.Cookie = cookie
      ;[accA, accB] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
      ])
    })

    it('creates all transactions and returns them', async () => {
      const res = await app.request('/api/transactions/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactions: [
            { date: '2026-01-10', description: 'Grocery run', postings: [{ accountId: accA.id, amount: '-25.00', currency: 'CAD' }, { accountId: accB.id, amount: '25.00', currency: 'CAD' }] },
            { date: '2026-01-11', description: 'Coffee', postings: [{ accountId: accA.id, amount: '-5.00', currency: 'CAD' }, { accountId: accB.id, amount: '5.00', currency: 'CAD' }] },
          ],
        }),
      })
      expect(res.status).toBe(201)
      const created = await res.json()
      expect(created).toHaveLength(2)
      expect(created[0].description).toBe('Grocery run')
      expect(created[1].description).toBe('Coffee')
    })

    it('rolls back the whole batch when one transaction has imbalanced postings', async () => {
      const res = await app.request('/api/transactions/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactions: [
            { date: '2026-01-10', postings: [{ accountId: accA.id, amount: '-25.00', currency: 'CAD' }, { accountId: accB.id, amount: '25.00', currency: 'CAD' }] },
            { date: '2026-01-11', postings: [{ accountId: accA.id, amount: '-5.00', currency: 'CAD' }, { accountId: accB.id, amount: '99.00', currency: 'CAD' }] },
          ],
        }),
      })
      expect(res.status).toBe(400)
      // Confirm nothing was persisted
      const txns = await app.request('/api/transactions', { headers: { Cookie: cookie } }).then(r => r.json())
      expect(txns).toHaveLength(0)
    })
  })

  describe('GET /api/transactions group expense linking', () => {
    let userId: string
    let groupId: string

    beforeEach(async () => {
      userId = (await app.request('/api/auth/get-session', { headers: { Cookie: cookie } }).then(r => r.json()) as any).user.id
      const [group] = await db
        .insert(expenseGroups)
        .values({ name: 'Quotidien', createdBy: userId })
        .returning()
      groupId = group.id
      await db.insert(expenseGroupMembers).values({ groupId, userId, shareWeight: 1 })
    })

    // A split expense logged from import (paid by me): the expense marks its origin import tx
    // via groupExpenses.transactionId, but the belongs-to relationship is the forward link —
    // the import tx carries groupExpenseId like any member tx, so one lookup surfaces both.
    it('resolves groupExpenseId + groupName for the origin import transaction (forward link)', async () => {
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
      const [wise, food] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:wise:czk' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food:groceries' }) }).then(r => r.json()),
      ])
      const created = await app.request('/api/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({ date: '2026-06-23', description: 'Albert', postings: [
          { accountId: wise.id, amount: '-717.80', currency: 'CZK' },
          { accountId: food.id, amount: '717.80', currency: 'CZK' },
        ] }),
      }).then(r => r.json()) as any

      // Mirror what createGroupExpenseInTx writes for an import-linked expense: the back-pointer
      // (origin marker) AND the total forward link on the same transaction.
      const [expense] = await db
        .insert(groupExpenses)
        .values({ groupId, paidByUserId: userId, description: 'Albert', amount: '717.80', currency: 'CZK', date: '2026-06-23', transactionId: created.id })
        .returning()
      await db.update(transactions).set({ groupExpenseId: expense.id }).where(eq(transactions.id, created.id))

      const data = await app.request('/api/transactions', { headers: { Cookie: cookie } }).then(r => r.json()) as any[]
      const tx = data.find((t) => t.id === created.id)
      expect(tx.groupExpenseId).toBe(expense.id)
      expect(tx.groupName).toBe('Quotidien')
    })

    // A member transaction created for a group expense links forward (transactions.groupExpenseId).
    it('resolves groupName via the forward member-transaction link', async () => {
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
      const [recv, food] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:receivable:quotidien' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food:restaurant' }) }).then(r => r.json()),
      ])
      const [expense] = await db
        .insert(groupExpenses)
        .values({ groupId, paidByUserId: userId, description: 'Ugo Delivery', amount: '287.95', currency: 'CZK', date: '2026-06-22' })
        .returning()
      const created = await app.request('/api/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({ date: '2026-06-22', description: 'Ugo Delivery', postings: [
          { accountId: food.id, amount: '287.95', currency: 'CZK' },
          { accountId: recv.id, amount: '-287.95', currency: 'CZK' },
        ] }),
      }).then(r => r.json()) as any
      await db.update(transactions).set({ groupExpenseId: expense.id }).where(eq(transactions.id, created.id))

      const data = await app.request('/api/transactions', { headers: { Cookie: cookie } }).then(r => r.json()) as any[]
      const tx = data.find((t) => t.id === created.id)
      expect(tx.groupExpenseId).toBe(expense.id)
      expect(tx.groupName).toBe('Quotidien')
    })

    it('leaves groupExpenseId + groupName null for an ordinary transaction', async () => {
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
      const [chequing, food] = await Promise.all([
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
        app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
      ])
      const created = await app.request('/api/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({ date: '2026-06-20', description: 'Solo lunch', postings: [
          { accountId: chequing.id, amount: '-12.00', currency: 'CAD' },
          { accountId: food.id, amount: '12.00', currency: 'CAD' },
        ] }),
      }).then(r => r.json()) as any

      const data = await app.request('/api/transactions', { headers: { Cookie: cookie } }).then(r => r.json()) as any[]
      const tx = data.find((t) => t.id === created.id)
      expect(tx.groupExpenseId).toBeNull()
      expect(tx.groupName).toBeNull()
    })
  })
})
