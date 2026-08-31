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

  it('accepts a split cash purchase from the Companion Spend tab', async () => {
    // The exact shape `buildCashPostings` produces: the wallet credited for the
    // whole purchase, one debit per expense account. This is the first thing in
    // the app to send more than two postings, so it pins the contract rather
    // than trusting that N-posting support still behaves.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [wallet, food, household, electronics] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:cash:cad', defaultCurrency: 'CAD' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:household' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:electronics' }) }).then(r => r.json()),
    ]) as { id: string }[]

    const res = await app.request('/api/transactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date: '2026-08-27',
        description: 'Costco run',
        postings: [
          { accountId: wallet.id, amount: '-180.00', currency: 'CAD' },
          { accountId: food.id, amount: '90.00', currency: 'CAD' },
          { accountId: household.id, amount: '60.00', currency: 'CAD' },
          { accountId: electronics.id, amount: '30.00', currency: 'CAD' },
        ],
      }),
    })

    expect(res.status).toBe(201)
    const created = await res.json() as { postings: { accountId: string; amount: string }[] }
    expect(created.postings).toHaveLength(4)

    // One payment, three categories — and the wallet is down the full amount.
    const balanceRes = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
    const balances = await balanceRes.json() as { id: string; balances: { currency: string; amount: string }[] }[]
    expect(balances).toEqual([])  // untagged: not a wallet yet

    await app.request(`/api/accounts/${wallet.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ type: 'cash' }),
    })
    const tagged = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
    const walletRow = (await tagged.json() as { balances: { currency: string; amount: string }[] }[])[0]
    expect(walletRow.balances).toEqual([{ currency: 'CAD', amount: '-180.00' }])
  })

  it('accepts a cross-currency wallet top-up bridged through the conversion account', async () => {
    // The 5-posting shape `buildTopUpPostings` produces for an exchange counter.
    // Two currencies cannot balance against each other, so each has to net to
    // zero on its own — that is exactly what the bridge is for.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, wallet, conversion, fees] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing', defaultCurrency: 'CAD' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:cash:cny', defaultCurrency: 'CNY' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'equity:conversion' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:fees:atm' }) }).then(r => r.json()),
    ]) as { id: string }[]

    const res = await app.request('/api/transactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date: '2026-08-27',
        description: 'Exchange to CNY',
        postings: [
          { accountId: chequing.id, amount: '-200.00', currency: 'CAD' },
          { accountId: fees.id, amount: '3.00', currency: 'CAD' },
          { accountId: conversion.id, amount: '197.00', currency: 'CAD' },
          { accountId: conversion.id, amount: '-1000.00', currency: 'CNY' },
          { accountId: wallet.id, amount: '1000.00', currency: 'CNY' },
        ],
      }),
    })

    expect(res.status).toBe(201)
    const created = await res.json() as { postings: { amount: string; currency: string }[] }
    expect(created.postings).toHaveLength(5)

    await app.request(`/api/accounts/${wallet.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ type: 'cash' }),
    })
    const balances = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
      .then(r => r.json()) as { balances: { currency: string; amount: string }[] }[]
    expect(balances[0].balances).toEqual([{ currency: 'CNY', amount: '1000.00' }])
  })

  it('rejects a cross-currency movement that skips the conversion bridge', async () => {
    // Without the bridge the two currencies each stand alone and unbalanced.
    // This is why the top-up flow refuses to save when no conversion account is
    // configured, rather than posting something the server would reject anyway.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [chequing, wallet] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:chequing' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:cash:cny' }) }).then(r => r.json()),
    ]) as { id: string }[]

    const res = await app.request('/api/transactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date: '2026-08-27',
        postings: [
          { accountId: chequing.id, amount: '-200.00', currency: 'CAD' },
          { accountId: wallet.id, amount: '1000.00', currency: 'CNY' },
        ],
      }),
    })

    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(/do not balance/)
  })

  it('rejects a split whose legs do not add up to the total', async () => {
    // The invariant `buildCashPostings` enforces client-side. If this ever
    // stopped being enforced server-side, a one-cent rounding slip would write
    // an unbalanced transaction into the ledger.
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const [wallet, food] = await Promise.all([
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'assets:cash:cad' }) }).then(r => r.json()),
      app.request('/api/accounts', { method: 'POST', headers, body: JSON.stringify({ path: 'expenses:food' }) }).then(r => r.json()),
    ]) as { id: string }[]

    const res = await app.request('/api/transactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date: '2026-08-27',
        postings: [
          { accountId: wallet.id, amount: '-100.00', currency: 'CAD' },
          { accountId: food.id, amount: '99.99', currency: 'CAD' },
        ],
      }),
    })

    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(/do not balance/)
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
