import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { and, eq } from 'drizzle-orm'
import { accounts as accountsTable, postings as postingsTable, transactions as transactionsTable } from '../db/schema.ts'

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

    // Helper: set (or clear, with null) an account's stored hledger type override
    async function setType(id: string, type: string | null) {
      const res = await app.request(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (res.status !== 200) throw new Error(`setType failed: ${res.status}`)
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

    it('reports each account\'s resolved type', async () => {
      await createAccount('assets:chequing')
      await createAccount('liabilities:visa')

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      const body = await res.json() as { path: string; type: string | null; resolvedType: string | null }[]

      const chequing = body.find(b => b.path === 'assets:chequing')!
      expect(chequing.resolvedType).toBe('asset')
      // Untagged, so the raw override is null and the type came from path inference.
      expect(chequing.type).toBeNull()
      expect(body.find(b => b.path === 'liabilities:visa')!.resolvedType).toBe('liability')
    })

    it('reports the stored override as the resolved type, not the inferred one', async () => {
      const walletId = await createAccount('assets:cash:cad')
      await setType(walletId, 'cash')

      const res = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
      const body = await res.json() as { path: string; type: string | null; resolvedType: string | null }[]

      const wallet = body.find(b => b.path === 'assets:cash:cad')!
      // `resolvedType` is stored-wins; inference alone would have said 'asset'. Both fields
      // mean the same thing they do on GET /api/accounts.
      expect(wallet.resolvedType).toBe('cash')
      expect(wallet.type).toBe('cash')
    })

    describe('?include=unfiled', () => {
      async function balances(qs = '') {
        const res = await app.request(`/api/accounts/balances${qs}`, {
          headers: { Cookie: cookie },
        })
        return { status: res.status, body: await res.json() }
      }

      async function paths(qs = '') {
        const { body } = await balances(qs)
        return (body as { path: string }[]).map((a) => a.path).sort()
      }

      it('omits an account outside every configured root by default', async () => {
        await createAccount('assets:chequing')
        await createAccount('\u50a8\u84c4:\u4e2d\u56fd\u94f6\u884c')
        expect(await paths()).toContain('assets:chequing')
        expect(await paths()).not.toContain('\u50a8\u84c4:\u4e2d\u56fd\u94f6\u884c')
      })

      it('includes it, with its balance, when asked', async () => {
        const stray = await createAccount('\u50a8\u84c4:\u4e2d\u56fd\u94f6\u884c')
        const food = await createAccount('expenses:food')
        await createTransaction([
          { accountId: stray, amount: '-900.00', currency: 'CNY' },
          { accountId: food, amount: '900.00', currency: 'CNY' },
        ])

        const { body } = await balances('?include=unfiled')
        const row = (body as { id: string; balances: unknown[] }[]).find(
          (a) => a.id === stray,
        )
        // The balance is the point: showing the row without its money would be its own lie.
        expect(row?.balances).toEqual([{ currency: 'CNY', amount: '-900.00' }])
      })

      it('still excludes expense and income accounts, which belong to Categories', async () => {
        await createAccount('expenses:food')
        await createAccount('income:salary')
        const all = await paths('?include=unfiled')
        expect(all).not.toContain('expenses:food')
        expect(all).not.toContain('income:salary')
      })

      it('treats a path outside the *configured* roots as unfiled, not the default ones', async () => {
        await app.request('/api/user-settings', {
          method: 'PATCH',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultAssetsRootPath: 'activos' }),
        })
        await createAccount('activos:banco')
        await createAccount('assets:chequing')

        const all = await paths('?include=unfiled')
        expect(all).toContain('activos:banco')
        // `assets` is no longer a root, so the old account is unfiled — and still visible.
        expect(all).toContain('assets:chequing')
      })

      it('includes an account sitting at the bare root path', async () => {
        await createAccount('assets')
        expect(await paths('?include=unfiled')).toContain('assets')
        // ...and so does the default selection, which used to drop it.
        expect(await paths()).toContain('assets')
      })

      it('rejects an unknown include value rather than ignoring it', async () => {
        expect((await balances('?include=everything')).status).toBe(400)
      })

      it('rejects combining include with types, which select different ways', async () => {
        expect((await balances('?include=unfiled&types=asset')).status).toBe(400)
      })

      it('never returns another user\'s unfiled account', async () => {
        const other = await createTestUser('unfiled-other@example.com')
        await app.request('/api/accounts', {
          method: 'POST',
          headers: { Cookie: other, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'theirs:secret' }),
        })
        expect(await paths('?include=unfiled')).not.toContain('theirs:secret')
      })
    })

    describe('?types= filter', () => {
      it('returns only accounts whose resolved type matches', async () => {
        const walletId = await createAccount('assets:cash:cad')
        await setType(walletId, 'cash')
        await createAccount('assets:chequing')
        await createAccount('liabilities:visa')

        const res = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
        expect(res.status).toBe(200)
        const body = await res.json() as { path: string }[]

        expect(body.map(b => b.path)).toEqual(['assets:cash:cad'])
      })

      it('includes a tagged account whose path sits outside every configured root', async () => {
        // The whole point of the stored override: an atypically-named root that path
        // inference cannot classify. The unfiltered endpoint selects by path root, so
        // this account is invisible there — the filter must find it by stored type.
        const walletId = await createAccount('储蓄:现金')
        await setType(walletId, 'cash')

        const unfiltered = await app.request('/api/accounts/balances', { headers: { Cookie: cookie } })
        expect((await unfiltered.json() as { path: string }[]).map(b => b.path)).not.toContain('储蓄:现金')

        const res = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
        const body = await res.json() as { path: string; resolvedType: string }[]
        expect(body.map(b => b.path)).toEqual(['储蓄:现金'])
        expect(body[0].resolvedType).toBe('cash')
      })

      it('excludes an account whose path looks like cash but carries no override', async () => {
        // Strict tag rule: inference never yields 'cash', so an untagged
        // `assets:cash:*` account is an ordinary asset and must not match.
        await createAccount('assets:cash:cad')

        const res = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
        expect(await res.json()).toEqual([])
      })

      it('excludes an account whose cash override was cleared', async () => {
        const walletId = await createAccount('assets:cash:cad')
        await setType(walletId, 'cash')
        await setType(walletId, null)

        const res = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
        expect(await res.json()).toEqual([])
      })

      it('sums balances for a filtered account', async () => {
        const walletId = await createAccount('assets:cash:cad')
        await setType(walletId, 'cash')
        const expenseId = await createAccount('expenses:food')

        await createTransaction([
          { accountId: walletId, amount: '300.00', currency: 'CAD' },
          { accountId: expenseId, amount: '-300.00', currency: 'CAD' },
        ])
        await createTransaction([
          { accountId: walletId, amount: '-40.00', currency: 'CAD' },
          { accountId: expenseId, amount: '40.00', currency: 'CAD' },
        ])

        const res = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
        const body = await res.json() as { path: string; balances: { currency: string; amount: string }[] }[]
        expect(body[0].balances).toEqual([{ currency: 'CAD', amount: '260.00' }])
      })

      it('returns a tagged account with no postings as empty balances', async () => {
        const walletId = await createAccount('assets:cash:jpy')
        await setType(walletId, 'cash')

        const res = await app.request('/api/accounts/balances?types=cash', { headers: { Cookie: cookie } })
        const body = await res.json() as { path: string; balances: unknown[] }[]
        expect(body).toHaveLength(1)
        expect(body[0].balances).toEqual([])
      })

      it('accepts several comma-separated types', async () => {
        const walletId = await createAccount('assets:cash:cad')
        await setType(walletId, 'cash')
        await createAccount('assets:chequing')
        await createAccount('expenses:food')

        const res = await app.request('/api/accounts/balances?types=cash,asset', { headers: { Cookie: cookie } })
        const body = await res.json() as { path: string }[]

        expect(body.map(b => b.path).sort()).toEqual(['assets:cash:cad', 'assets:chequing'])
      })

      it('rejects an unknown type', async () => {
        const res = await app.request('/api/accounts/balances?types=wallet', { headers: { Cookie: cookie } })
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'invalid account type: wallet' })
      })

      it('rejects an empty types parameter rather than returning everything', async () => {
        const res = await app.request('/api/accounts/balances?types=', { headers: { Cookie: cookie } })
        expect(res.status).toBe(400)
      })

      it('matches an untagged account by path inference', async () => {
        await createAccount('assets:chequing')
        await createAccount('expenses:food')

        const res = await app.request('/api/accounts/balances?types=expense', { headers: { Cookie: cookie } })
        const body = await res.json() as { path: string; resolvedType: string }[]

        expect(body.map(b => b.path)).toContain('expenses:food')
        expect(body.map(b => b.path)).not.toContain('assets:chequing')
      })

      it('matches an account sitting at a root itself, not just under it', async () => {
        await createAccount('assets')

        const res = await app.request('/api/accounts/balances?types=asset', { headers: { Cookie: cookie } })
        expect((await res.json() as { path: string }[]).map(b => b.path)).toContain('assets')
      })

      it('falls back to inference for an account whose stored type is not a valid one', async () => {
        // Can't happen through the API (PATCH validates), but the resolver treats an
        // unusable stored value as "infer", and the SQL narrowing must not drop the row
        // before the resolver ever sees it.
        const id = await createAccount('assets:chequing')
        await db.update(accountsTable).set({ type: 'not-a-type' }).where(eq(accountsTable.id, id))

        const res = await app.request('/api/accounts/balances?types=asset', { headers: { Cookie: cookie } })
        const body = await res.json() as { path: string; resolvedType: string }[]

        const chequing = body.find(b => b.path === 'assets:chequing')
        expect(chequing).toBeDefined()
        expect(chequing!.resolvedType).toBe('asset')
      })

      it('never returns another user\'s cash accounts', async () => {
        const walletId = await createAccount('assets:cash:cad')
        await setType(walletId, 'cash')

        const otherCookie = await createTestUser('other@example.com')
        const res = await app.request('/api/accounts/balances?types=cash', {
          headers: { Cookie: otherCookie },
        })
        expect(await res.json()).toEqual([])
      })
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

  describe('POST /api/accounts accepts only what it means to', () => {
    function create(body: unknown) {
      return app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    it('creates an account from the four fields it does accept', async () => {
      const res = await create({
        path: 'assets:chequing',
        name: 'Chequing',
        defaultCurrency: 'USD',
        type: 'cash',
      })

      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({
        path: 'assets:chequing',
        name: 'Chequing',
        defaultCurrency: 'USD',
        type: 'cash',
      })
    })

    // The route used to spread the whole request body into the insert, so any column the
    // client named was a column the client could set.
    it('ignores an id the client tried to choose', async () => {
      const chosen = '00000000-0000-4000-8000-000000000001'

      const res = await create({ path: 'assets:chequing', id: chosen })

      expect(res.status).toBe(201)
      expect((await res.json() as Account).id).not.toBe(chosen)
    })

    it('ignores a deletedAt, which would have created an invisible account', async () => {
      const res = await create({
        path: 'assets:chequing',
        deletedAt: new Date('2020-01-01').toISOString(),
      })
      expect(res.status).toBe(201)

      // Born deleted, it would never have appeared in a listing again.
      const list = await app.request('/api/accounts', { headers: { Cookie: cookie } })
      expect((await list.json() as Account[]).map((a) => a.path)).toContain('assets:chequing')
    })

    it('ignores a backdated createdAt', async () => {
      const before = Date.now()

      const res = await create({
        path: 'assets:chequing',
        createdAt: new Date('1999-01-01').toISOString(),
      })

      const created = await res.json() as Account
      expect(new Date(created.createdAt!).getTime()).toBeGreaterThanOrEqual(before - 1000)
    })

    it('still ignores a userId, as it always did', async () => {
      const otherCookie = await createTestUser('other@example.com')
      const otherId = await app
        .request('/api/auth/get-session', { headers: { Cookie: otherCookie } })
        .then(async (r) => (await r.json()).user.id as string)

      await create({ path: 'assets:chequing', userId: otherId })

      // Their listing is not empty — sign-up seeds default accounts — so the assertion is
      // that the account landed on the caller, not on the id they named.
      const theirs = await app.request('/api/accounts', { headers: { Cookie: otherCookie } })
      expect((await theirs.json() as Account[]).map((a) => a.path)).not.toContain('assets:chequing')
    })

    it('rejects a missing or malformed path instead of failing at the column', async () => {
      expect((await create({})).status).toBe(400)
      expect((await create({ path: '' })).status).toBe(400)
      expect((await create({ path: 'assets::chequing' })).status).toBe(400)
      expect((await create({ path: ' assets:chequing' })).status).toBe(400)
      expect((await create({ path: 42 })).status).toBe(400)
    })

    it('rejects an account type it would refuse on update', async () => {
      const res = await create({ path: 'assets:chequing', type: 'wallet' })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid account type' })
    })

    it('accepts a null type, which means infer from the path', async () => {
      const res = await create({ path: 'assets:chequing', type: null })

      expect(res.status).toBe(201)
      expect((await res.json() as Account).type).toBeNull()
    })

    // The rename route refuses to move an account into the receivable namespace because
    // those are system-managed and re-spawned at import. Creating one there directly was
    // the same hole by another door.
    it('refuses to create inside the receivable namespace', async () => {
      const res = await create({ path: 'assets:receivable:someone' })

      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('receivable') })
    })

    it('rejects a non-string name rather than storing it', async () => {
      expect((await create({ path: 'assets:chequing', name: 42 })).status).toBe(400)
    })
  })

  describe('PATCH /api/accounts/:id defaultCurrency', () => {
    async function make(): Promise<Account> {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'assets:chequing', defaultCurrency: 'USD' }),
      })
      return await res.json() as Account
    }

    function patch(id: string, body: unknown) {
      return app.request(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    it('clears the currency back to the user default when sent null', async () => {
      const account = await make()

      const res = await patch(account.id, { defaultCurrency: null })

      expect(res.status).toBe(200)
      expect((await res.json() as Account).defaultCurrency).toBeNull()
    })

    it('rejects a code outside the supported set rather than storing it', async () => {
      const account = await make()

      const res = await patch(account.id, { defaultCurrency: 'BANANA' })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid currency' })

      // The stored value is untouched — a rejected write must not be a partial one.
      const after = await app.request(`/api/accounts/${account.id}`, { headers: { Cookie: cookie } })
      expect((await after.json() as Account).defaultCurrency).toBe('USD')
    })

    it('rejects a non-string just as firmly', async () => {
      const account = await make()

      expect((await patch(account.id, { defaultCurrency: 42 })).status).toBe(400)
      expect((await patch(account.id, { defaultCurrency: {} })).status).toBe(400)
    })

    it('normalises case, so "usd" is stored as USD', async () => {
      const account = await make()

      const res = await patch(account.id, { defaultCurrency: 'eur' })

      expect(res.status).toBe(200)
      expect((await res.json() as Account).defaultCurrency).toBe('EUR')
    })

    it('is checked at creation too, not only on update', async () => {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'assets:savings', defaultCurrency: 'BANANA' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid currency' })
    })

    it('does not reject the other fields when currency is absent', async () => {
      const account = await make()

      const res = await patch(account.id, { name: 'Chequing' })

      expect(res.status).toBe(200)
      expect((await res.json() as Account).name).toBe('Chequing')
    })
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

    async function seedReceivable(path: string) {
      const userId = await app
        .request('/api/auth/get-session', { headers: { Cookie: cookie } })
        .then(async (r) => (await r.json()).user.id as string)
      const [acct] = await db.insert(accountsTable).values({ userId, path }).returning()
      return acct!
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
      // Seeded the way the system seeds them — fish-pie-accounts inserts directly, and the
      // create route now refuses this namespace, which is the point of the rename guard too.
      const acct = await seedReceivable('assets:receivable:trip')
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

  describe('account type override (PATCH + GET /:id)', () => {
    async function create(body: Record<string, unknown>) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return (await res.json() as Account).id
    }

    async function patch(id: string, body: Record<string, unknown>) {
      return app.request(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    type AccountDetail = Account & {
      type: string | null
      resolvedType: string | null
      inferredType: string | null
    }
    async function getOne(id: string) {
      const res = await app.request(`/api/accounts/${id}`, { headers: { Cookie: cookie } })
      return await res.json() as AccountDetail
    }

    it('GET /:id surfaces resolvedType and the pure inferredType', async () => {
      // override flips an account whose path infers to expense
      const id = await create({ path: 'expenses:weird', type: 'asset' })
      const acct = await getOne(id)
      expect(acct.type).toBe('asset')
      expect(acct.resolvedType).toBe('asset')   // stored override wins
      expect(acct.inferredType).toBe('expense') // what it would be without the override
    })

    it('GET /:id inferredType is null for an atypical root', async () => {
      const id = await create({ path: '储蓄:中国银行' })
      const acct = await getOne(id)
      expect(acct.resolvedType).toBeNull()
      expect(acct.inferredType).toBeNull()
    })

    it('PATCH sets a valid override type', async () => {
      const id = await create({ path: '储蓄:中国银行' })
      const res = await patch(id, { type: 'asset' })
      expect(res.status).toBe(200)
      expect((await getOne(id)).resolvedType).toBe('asset')
    })

    it('PATCH accepts the override-only Cash and Conversion types', async () => {
      const id = await create({ path: 'equity:conversion' })
      expect((await patch(id, { type: 'conversion' })).status).toBe(200)
      expect((await getOne(id)).type).toBe('conversion')
    })

    it('PATCH with type:null clears the override back to inference', async () => {
      const id = await create({ path: 'assets:chequing', type: 'liability' })
      expect((await getOne(id)).resolvedType).toBe('liability')
      const res = await patch(id, { type: null })
      expect(res.status).toBe(200)
      const acct = await getOne(id)
      expect(acct.type).toBeNull()
      expect(acct.resolvedType).toBe('asset') // falls back to inference
    })

    it('PATCH rejects an invalid type with 400', async () => {
      const id = await create({ path: 'assets:chequing' })
      const res = await patch(id, { type: 'bogus' })
      expect(res.status).toBe(400)
      // unchanged — still inferred
      expect((await getOne(id)).type).toBeNull()
    })

    it('PATCH does not touch another user\'s account', async () => {
      const other = await createTestUser('other2@example.com')
      const otherRes = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: other, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'assets:chequing' }),
      })
      const otherId = (await otherRes.json() as Account).id
      const res = await patch(otherId, { type: 'liability' })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/accounts/posting-counts', () => {
    type CountRow = { accountId: string; count: number; lastActivity: string | null }

    async function createAccount(path: string, useCookie = cookie) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: useCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return (await res.json() as Account).id
    }

    // Creates a balanced two-posting transaction on the given date and returns its id.
    async function createTransaction(
      date: string,
      postingInputs: { accountId: string; amount: string; currency?: string }[],
      useCookie = cookie,
    ) {
      const res = await app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: useCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          postings: postingInputs.map(p => ({ currency: 'CAD', ...p })),
        }),
      })
      if (res.status !== 201) throw new Error(`createTransaction failed: ${res.status}`)
      return (await res.json() as { id: string }).id
    }

    async function fetchCounts(useCookie = cookie) {
      const res = await app.request('/api/accounts/posting-counts', { headers: { Cookie: useCookie } })
      expect(res.status).toBe(200)
      return await res.json() as CountRow[]
    }

    async function rowFor(accountId: string, useCookie = cookie) {
      return (await fetchCounts(useCookie)).find(r => r.accountId === accountId)
    }

    it('returns the posting count and the most recent transaction date together', async () => {
      const chequing = await createAccount('assets:chequing')
      const food = await createAccount('expenses:food')
      await createTransaction('2024-01-15', [
        { accountId: chequing, amount: '-10.00' },
        { accountId: food, amount: '10.00' },
      ])
      await createTransaction('2024-03-02', [
        { accountId: chequing, amount: '-25.00' },
        { accountId: food, amount: '25.00' },
      ])

      expect(await rowFor(chequing)).toEqual({
        accountId: chequing,
        count: 2,
        lastActivity: '2024-03-02',
      })
    })

    it('takes the maximum date, not the most recently created transaction', async () => {
      const chequing = await createAccount('assets:chequing')
      const food = await createAccount('expenses:food')
      await createTransaction('2024-06-01', [
        { accountId: chequing, amount: '-10.00' },
        { accountId: food, amount: '10.00' },
      ])
      // Backdated entry, created second — must not become the last activity.
      await createTransaction('2023-01-01', [
        { accountId: chequing, amount: '-10.00' },
        { accountId: food, amount: '10.00' },
      ])
      expect((await rowFor(chequing))?.lastActivity).toBe('2024-06-01')
    })

    it('reports count 0 and lastActivity null for an account with no postings', async () => {
      const empty = await createAccount('assets:unused')
      expect(await rowFor(empty)).toEqual({ accountId: empty, count: 0, lastActivity: null })
    })

    it('excludes soft-deleted postings from both the count and the date', async () => {
      const chequing = await createAccount('assets:chequing')
      const food = await createAccount('expenses:food')
      await createTransaction('2024-01-15', [
        { accountId: chequing, amount: '-10.00' },
        { accountId: food, amount: '10.00' },
      ])
      const recent = await createTransaction('2024-09-30', [
        { accountId: chequing, amount: '-25.00' },
        { accountId: food, amount: '25.00' },
      ])
      await db.update(postingsTable)
        .set({ deletedAt: new Date() })
        .where(and(eq(postingsTable.transactionId, recent), eq(postingsTable.accountId, chequing)))

      // The chequing leg of the September transaction is gone; the food leg is not.
      expect(await rowFor(chequing)).toEqual({ accountId: chequing, count: 1, lastActivity: '2024-01-15' })
      expect((await rowFor(food))?.count).toBe(2)
    })

    it('excludes postings whose transaction is soft-deleted', async () => {
      const chequing = await createAccount('assets:chequing')
      const food = await createAccount('expenses:food')
      await createTransaction('2024-01-15', [
        { accountId: chequing, amount: '-10.00' },
        { accountId: food, amount: '10.00' },
      ])
      const recent = await createTransaction('2024-09-30', [
        { accountId: chequing, amount: '-25.00' },
        { accountId: food, amount: '25.00' },
      ])
      await db.update(transactionsTable)
        .set({ deletedAt: new Date() })
        .where(eq(transactionsTable.id, recent))

      expect(await rowFor(chequing)).toEqual({ accountId: chequing, count: 1, lastActivity: '2024-01-15' })
    })

    it('omits soft-deleted accounts entirely', async () => {
      const closed = await createAccount('assets:closed')
      await db.update(accountsTable).set({ deletedAt: new Date() }).where(eq(accountsTable.id, closed))
      expect(await rowFor(closed)).toBeUndefined()
    })

    it('never counts another user\'s postings', async () => {
      const other = await createTestUser('counts-other@example.com')
      const mine = await createAccount('assets:chequing')
      const theirs = await createAccount('assets:chequing', other)
      const theirFood = await createAccount('expenses:food', other)
      await createTransaction('2024-05-05', [
        { accountId: theirs, amount: '-10.00' },
        { accountId: theirFood, amount: '10.00' },
      ], other)

      // My listing sees neither their account nor their activity.
      const mineRows = await fetchCounts()
      expect(mineRows.find(r => r.accountId === theirs)).toBeUndefined()
      expect(mineRows.find(r => r.accountId === mine)).toEqual({
        accountId: mine, count: 0, lastActivity: null,
      })
      // Theirs is intact from their side.
      expect(await rowFor(theirs, other)).toEqual({
        accountId: theirs, count: 1, lastActivity: '2024-05-05',
      })
    })
  })
  describe('DELETE /api/accounts/:id', () => {
    async function createAccount(path: string, useCookie = cookie) {
      const res = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: useCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      return (await res.json() as Account).id
    }

    async function createTransaction(
      postingInputs: { accountId: string; amount: string }[],
      useCookie = cookie,
    ) {
      const res = await app.request('/api/transactions', {
        method: 'POST',
        headers: { Cookie: useCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2024-03-03',
          postings: postingInputs.map(p => ({ currency: 'CAD', ...p })),
        }),
      })
      if (res.status !== 201) throw new Error(`createTransaction failed: ${res.status}`)
      return (await res.json() as { id: string }).id
    }

    async function del(id: string, useCookie = cookie) {
      return app.request(`/api/accounts/${id}`, {
        method: 'DELETE',
        headers: { Cookie: useCookie, 'Content-Type': 'application/json' },
      })
    }

    async function pathsFor(useCookie = cookie) {
      const res = await app.request('/api/accounts', { headers: { Cookie: useCookie } })
      return (await res.json() as Account[]).map(a => a.path)
    }

    it('deletes an account nothing depends on', async () => {
      const id = await createAccount('expenses:hobbies')

      expect((await del(id)).status).toBe(204)
      expect(await pathsFor()).not.toContain('expenses:hobbies')
    })

    it('refuses an account that still has entries, and says how many', async () => {
      const chequing = await createAccount('assets:chequing')
      const food = await createAccount('expenses:food')
      await createTransaction([
        { accountId: chequing, amount: '-10.00' },
        { accountId: food, amount: '10.00' },
      ])

      const res = await del(food)
      expect(res.status).toBe(409)
      expect((await res.json() as { error: string }).error).toContain('1 entry')
      // Still there — a refused delete must not half-apply.
      expect(await pathsFor()).toContain('expenses:food')
    })

    it('allows the delete once the entries are gone', async () => {
      const chequing = await createAccount('assets:chequing')
      const food = await createAccount('expenses:food')
      const txId = await createTransaction([
        { accountId: chequing, amount: '-10.00' },
        { accountId: food, amount: '10.00' },
      ])

      expect((await del(food)).status).toBe(409)

      // A soft-deleted transaction is already gone, so it no longer holds the account.
      const delTx = await app.request(`/api/transactions/${txId}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      })
      expect(delTx.status).toBeLessThan(300)

      expect((await del(food)).status).toBe(204)
    })

    it('refuses an account a default role points at, naming the role', async () => {
      const offset = await createAccount('equity:opening')
      const patch = await app.request('/api/user-settings', {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultOffsetAccountId: offset }),
      })
      expect(patch.status).toBe(200)

      const res = await del(offset)
      expect(res.status).toBe(409)
      expect((await res.json() as { error: string }).error).toContain('offset')

      // Re-pointing the setting releases it.
      await app.request('/api/user-settings', {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultOffsetAccountId: null }),
      })
      expect((await del(offset)).status).toBe(204)
    })

    it('refuses a receivable account, which Fish Pie re-spawns anyway', async () => {
      // Inserted directly: POST refuses the receivable namespace by design, so the only way
      // one exists is Fish Pie spawning it.
      const mine = await createAccount('assets:chequing')
      const [owner] = await db
        .select({ userId: accountsTable.userId })
        .from(accountsTable)
        .where(eq(accountsTable.id, mine))
      const [row] = await db
        .insert(accountsTable)
        .values({ userId: owner!.userId, path: 'assets:receivable:alice' })
        .returning()

      const res = await del(row!.id)
      expect(res.status).toBe(409)
      expect((await res.json() as { error: string }).error).toContain('system-managed')
    })

    it('404s on another user\'s account rather than reporting success', async () => {
      const other = await createTestUser('other-delete@example.com')
      const theirs = await createAccount('assets:theirs', other)

      expect((await del(theirs)).status).toBe(404)
      // Untouched from their side.
      expect(await pathsFor(other)).toContain('assets:theirs')
    })

    it('404s on an account that is already deleted', async () => {
      const id = await createAccount('expenses:gone')
      expect((await del(id)).status).toBe(204)
      expect((await del(id)).status).toBe(404)
    })
  })
})
