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

  describe('GET /api/accounts/balances', () => {
    // Helper: create an account and return its id
    async function createAccount(path: string) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return (await res.json() as Account).id
    }

    // Helper: create a transaction with the given postings
    async function createTransaction(postingInputs: { accountId: string; amount: string; currency: string }[]) {
      return app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2024-01-01', postings: postingInputs }),
      })
    }

    it('returns asset accounts with their summed balances', async () => {
      const assetId = await createAccount('assets:chequing')
      const expenseId = await createAccount('expenses:food')

      await createTransaction([
        { accountId: assetId, amount: '1000.00', currency: 'CAD' },
        { accountId: expenseId, amount: '-1000.00', currency: 'CAD' },
      ])

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      const body = await res.json() as { path: string; balances: { currency: string; amount: string }[] }[]

      // Only the assets account should appear — expenses:food is excluded
      const paths = body.map(b => b.path)
      expect(paths).toContain('assets:chequing')
      expect(paths).not.toContain('expenses:food')

      const chequing = body.find(b => b.path === 'assets:chequing')!
      expect(chequing.balances).toEqual([{ currency: 'CAD', amount: '1000.00' }])
    })

    it('returns an account with no postings as empty balances', async () => {
      await createAccount('assets:savings')

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      const body = await res.json() as { path: string; balances: unknown[] }[]

      const savings = body.find(b => b.path === 'assets:savings')
      expect(savings).toBeDefined()
      expect(savings!.balances).toEqual([])
    })

    it('returns multiple currency balances for a multi-currency account', async () => {
      const assetId = await createAccount('assets:wise:cad')
      const conversionId = await createAccount('equity:conversions')

      // Two transactions in different currencies
      await createTransaction([
        { accountId: assetId, amount: '500.00', currency: 'CAD' },
        { accountId: conversionId, amount: '-500.00', currency: 'CAD' },
      ])
      await createTransaction([
        { accountId: assetId, amount: '200.00', currency: 'GBP' },
        { accountId: conversionId, amount: '-200.00', currency: 'GBP' },
      ])

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      const body = await res.json() as { path: string; balances: { currency: string; amount: string }[] }[]

      const wise = body.find(b => b.path === 'assets:wise:cad')!
      expect(wise.balances).toHaveLength(2)
      expect(wise.balances).toEqual(expect.arrayContaining([
        { currency: 'CAD', amount: '500.00' },
        { currency: 'GBP', amount: '200.00' },
      ]))
    })
  })

  describe('GET /api/accounts/:id/balance', () => {
    async function createAccount(path: string) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return (await res.json() as { id: string }).id
    }

    async function createTransaction(date: string, postingInputs: { accountId: string; amount: string; currency: string }[]) {
      return app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, postings: postingInputs }),
      })
    }

    it('returns balance as of the given date, excluding later transactions', async () => {
      const assetId = await createAccount('assets:chequing')
      const expenseId = await createAccount('expenses:food')

      await createTransaction('2024-01-01', [
        { accountId: assetId, amount: '1000.00', currency: 'CAD' },
        { accountId: expenseId, amount: '-1000.00', currency: 'CAD' },
      ])
      await createTransaction('2024-03-01', [
        { accountId: assetId, amount: '500.00', currency: 'CAD' },
        { accountId: expenseId, amount: '-500.00', currency: 'CAD' },
      ])

      const res = await app.request(`/api/accounts/${assetId}/balance?date=2024-01-31`, {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { accountId: string; date: string; balances: { currency: string; amount: string }[] }
      expect(body.balances).toEqual([{ currency: 'CAD', amount: '1000.00' }])
    })
  })

  describe('action-required endpoints', () => {
    async function createAccount(path: string): Promise<string> {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return (await res.json() as { id: string }).id
    }

    async function createTransaction(
      date: string,
      postings: { accountId: string; amount: string; currency: string }[],
    ): Promise<string> {
      const res = await app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, postings }),
      })
      return (await res.json() as { id: string }).id
    }

    async function setSettings(body: Record<string, string | null>) {
      return app.request('/api/user-settings', {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    it('GET /api/accounts/:id/action-required flags uncategorized transactions', async () => {
      const assetId = await createAccount('assets:chequing')
      const offsetId = await createAccount('expenses:uncategorized')
      await setSettings({ defaultOffsetAccountId: offsetId })

      // Needs action — posts to the offset account
      const flaggedId = await createTransaction('2024-01-15', [
        { accountId: assetId, amount: '-50.00', currency: 'CAD' },
        { accountId: offsetId, amount: '50.00', currency: 'CAD' },
      ])

      // Clean transaction — no offset account posting
      const cleanExpenseId = await createAccount('expenses:food')
      await createTransaction('2024-01-15', [
        { accountId: assetId, amount: '-20.00', currency: 'CAD' },
        { accountId: cleanExpenseId, amount: '20.00', currency: 'CAD' },
      ])

      const res = await app.request(`/api/accounts/${assetId}/action-required`, {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { count: number; transactionIds: string[] }
      expect(body.count).toBe(1)
      expect(body.transactionIds).toContain(flaggedId)
    })

    it('GET /api/accounts/action-required-summary returns counts per account', async () => {
      const assetId = await createAccount('assets:chequing')
      const offsetId = await createAccount('expenses:uncategorized')
      await setSettings({ defaultOffsetAccountId: offsetId })

      await createTransaction('2024-01-15', [
        { accountId: assetId, amount: '-50.00', currency: 'CAD' },
        { accountId: offsetId, amount: '50.00', currency: 'CAD' },
      ])

      const res = await app.request('/api/accounts/action-required-summary', {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { accountId: string; count: number }[]

      const assetEntry = body.find((e) => e.accountId === assetId)
      expect(assetEntry).toBeDefined()
      expect(assetEntry!.count).toBe(1)

      // The offset account itself is also touched by the transaction
      const offsetEntry = body.find((e) => e.accountId === offsetId)
      expect(offsetEntry).toBeDefined()
    })
  })

  it('PATCH /api/accounts/:id updates defaultCurrency and returns it on GET', async () => {
    const createRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets:chequing' }),
    })
    const created = await createRes.json() as Account

    const patchRes = await app.request(`/api/accounts/${created.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultCurrency: 'USD' }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json() as Account
    expect(patched.defaultCurrency).toBe('USD')

    const getRes = await app.request(`/api/accounts/${created.id}`, {
      headers: { Cookie: cookie },
    })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json() as Account
    expect(fetched.defaultCurrency).toBe('USD')
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

  describe('POST /api/accounts/rename', () => {
    async function createAccount(path: string): Promise<Account> {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return res.json() as Promise<Account>
    }

    async function rename(from: string, to: string, c = cookie) {
      return app.request('/api/accounts/rename', {
        method: 'POST',
        headers: { Cookie: c, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
    }

    async function pathOf(id: string): Promise<string> {
      const res = await app.request(`/api/accounts/${id}`, { headers: { Cookie: cookie } })
      return (await res.json() as Account).path
    }

    it('renames a leaf path and keeps the same id', async () => {
      const acct = await createAccount('expenses:food:cafe')
      const res = await rename('expenses:food:cafe', 'expenses:food:coffeeshop')
      expect(res.status).toBe(200)
      const body = await res.json() as { renamed: number; accounts: Account[] }
      expect(body.renamed).toBe(1)
      expect(body.accounts[0].id).toBe(acct.id)
      expect(await pathOf(acct.id)).toBe('expenses:food:coffeeshop')
    })

    it('leaves postings pointed at the renamed account (stable id)', async () => {
      const acct = await createAccount('expenses:food:cafe')
      await app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2024-01-01',
          postings: [
            { accountId: acct.id, amount: '-10.00', currency: 'CAD' },
            { accountId: acct.id, amount: '10.00', currency: 'CAD' },
          ],
        }),
      })
      await rename('expenses:food:cafe', 'expenses:food:coffeeshop')
      const counts = await app.request('/api/accounts/posting-counts', { headers: { Cookie: cookie } })
      const row = (await counts.json() as { accountId: string; count: number }[]).find(r => r.accountId === acct.id)
      expect(row?.count).toBe(2)
    })

    it('cascades a parent rename to every descendant', async () => {
      const cafe = await createAccount('expenses:food:cafe')
      const resto = await createAccount('expenses:food:resto')
      const res = await rename('expenses:food', 'expenses:dining')
      expect(res.status).toBe(200)
      expect((await res.json() as { renamed: number }).renamed).toBe(2)
      expect(await pathOf(cafe.id)).toBe('expenses:dining:cafe')
      expect(await pathOf(resto.id)).toBe('expenses:dining:resto')
    })

    it('renames a virtual parent that has no account row of its own', async () => {
      // No `expenses:food` row exists — only leaves below it.
      const cafe = await createAccount('expenses:food:cafe')
      const res = await rename('expenses:food', 'expenses:dining')
      expect(res.status).toBe(200)
      expect(await pathOf(cafe.id)).toBe('expenses:dining:cafe')
    })

    it('anchors the prefix so sibling accounts with a shared prefix are untouched', async () => {
      const cafe = await createAccount('expenses:food:cafe')
      const court = await createAccount('expenses:foodcourt:mall')
      await rename('expenses:food', 'expenses:dining')
      expect(await pathOf(cafe.id)).toBe('expenses:dining:cafe')
      expect(await pathOf(court.id)).toBe('expenses:foodcourt:mall')
    })

    it('rejects a rename that would collide with an existing path (merge, not rename)', async () => {
      const cafe = await createAccount('expenses:food:cafe')
      await createAccount('expenses:food:coffeeshop')
      const res = await rename('expenses:food:cafe', 'expenses:food:coffeeshop')
      expect(res.status).toBe(409)
      expect(await pathOf(cafe.id)).toBe('expenses:food:cafe')
    })

    it('rejects a cascade where any descendant would collide', async () => {
      const cafe = await createAccount('expenses:food:cafe')
      await createAccount('expenses:dining:cafe')
      const res = await rename('expenses:food', 'expenses:dining')
      expect(res.status).toBe(409)
      expect(await pathOf(cafe.id)).toBe('expenses:food:cafe')
    })

    it('rejects renaming a receivable (system-managed) account', async () => {
      const acct = await createAccount('assets:receivable:trip')
      const res = await rename('assets:receivable:trip', 'assets:receivable:vacation')
      expect(res.status).toBe(400)
      expect(await pathOf(acct.id)).toBe('assets:receivable:trip')
    })

    it('rejects renaming into the receivable namespace', async () => {
      await createAccount('expenses:food:cafe')
      const res = await rename('expenses:food:cafe', 'assets:receivable:cafe')
      expect(res.status).toBe(400)
    })

    it('rejects an invalid target path', async () => {
      await createAccount('expenses:food:cafe')
      expect((await rename('expenses:food:cafe', 'expenses::cafe')).status).toBe(400)
      expect((await rename('expenses:food:cafe', ' expenses:cafe')).status).toBe(400)
      expect((await rename('expenses:food:cafe', '')).status).toBe(400)
    })

    it('returns 404 when no account matches', async () => {
      const res = await rename('expenses:nonexistent', 'expenses:whatever')
      expect(res.status).toBe(404)
    })

    it('does not rename another user\'s accounts', async () => {
      const other = await createTestUser('other@example.com')
      const otherAcctRes = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: other, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'expenses:food:cafe' }),
      })
      const otherAcct = await otherAcctRes.json() as Account
      // Current user has no such account → 404, and the other user's row is untouched.
      const res = await rename('expenses:food:cafe', 'expenses:food:coffeeshop')
      expect(res.status).toBe(404)
      const check = await app.request(`/api/accounts/${otherAcct.id}`, { headers: { Cookie: other } })
      expect((await check.json() as Account).path).toBe('expenses:food:cafe')
    })
  })

  describe('GET /api/accounts resolvedType', () => {
    type AccountWithType = Account & { resolvedType: string | null }

    async function create(body: Record<string, unknown>) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return (await res.json() as Account).id
    }

    async function get(id: string) {
      const res = await app.request('/api/accounts', { headers: { Cookie: cookie } })
      const all = await res.json() as AccountWithType[]
      return all.find((a) => a.id === id)!
    }

    it('infers resolvedType from the path root when no override is stored', async () => {
      const id = await create({ path: 'assets:chequing' })
      const acct = await get(id)
      expect(acct.type).toBeNull()
      expect(acct.resolvedType).toBe('asset')
    })

    it('lets a stored type override inference', async () => {
      const id = await create({ path: 'expenses:weird', type: 'asset' })
      const acct = await get(id)
      expect(acct.type).toBe('asset')
      expect(acct.resolvedType).toBe('asset')
    })

    it('resolves an atypically-named root via its stored override', async () => {
      const id = await create({ path: '储蓄:中国银行', type: 'asset' })
      const acct = await get(id)
      expect(acct.resolvedType).toBe('asset')
    })

    it('returns null resolvedType for an atypical root with no override', async () => {
      const id = await create({ path: '花钱:房租' })
      const acct = await get(id)
      expect(acct.type).toBeNull()
      expect(acct.resolvedType).toBeNull()
    })

    it('surfaces an override-only type (cash/conversion) that inference cannot produce', async () => {
      const cashId = await create({ path: 'assets:wise:cad', type: 'cash' })
      const convId = await create({ path: 'equity:conversion', type: 'conversion' })
      expect((await get(cashId)).resolvedType).toBe('cash')
      expect((await get(convId)).resolvedType).toBe('conversion')
    })
  })
})
