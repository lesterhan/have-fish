import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { returnedRow } from '../db/returning'
import { accounts as accountsTable, csvParsers, fxRates, userSettings } from '../db/schema'
import { at, clearDatabase, createTestUser, request } from '../test-utils'

// Resolves a user's id from a session cookie via the /api/accounts/me-less path:
// we read it off any created account instead. Simpler: createAccount returns ids, and
// userId is needed only to seed a parser/settings row — fetch it from the settings row.
async function getUserId(cookie: string): Promise<string> {
  const res = await request('/api/user-settings', { headers: { Cookie: cookie } })
  const body = (await res.json()) as { userId: string }
  return body.userId
}

// Helper: create an account via the API and return its id
async function createAccount(cookie: string, path: string): Promise<string> {
  const res = await request('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ path }),
  })
  const body = (await res.json()) as { id: string }
  return body.id
}

// Helper: set an account's stored hledger type override
async function setType(cookie: string, id: string, type: string | null): Promise<void> {
  const res = await request(`/api/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ type }),
  })
  if (res.status !== 200) throw new Error(`setType failed: ${res.status}`)
}

// Helper: create a balanced transaction via the API
async function createTransaction(
  cookie: string,
  date: string,
  description: string,
  postings: { accountId: string; amount: string; currency: string }[],
): Promise<void> {
  await request('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ date, description, postings }),
  })
}

describe('reports', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('GET /api/reports/spending-summary returns empty totals when there are no transactions', async () => {
    const res = await request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: Record<string, string>; categories: unknown[] }
    expect(body.total).toEqual({})
    expect(body.categories).toEqual([])
  })

  it('GET /api/reports/spending-summary returns childCount and supports prefix drill-down', async () => {
    // Seed accounts: one source + two expense subcategories under expenses:food
    const source = await createAccount(cookie, 'assets:chq')
    const restaurant = await createAccount(cookie, 'expenses:food:restaurant')
    const groceries = await createAccount(cookie, 'expenses:food:groceries')

    await createTransaction(cookie, '2025-01-15', 'Dinner', [
      { accountId: source, amount: '-50.00', currency: 'CAD' },
      { accountId: restaurant, amount: '50.00', currency: 'CAD' },
    ])
    await createTransaction(cookie, '2025-01-20', 'Groceries', [
      { accountId: source, amount: '-120.00', currency: 'CAD' },
      { accountId: groceries, amount: '120.00', currency: 'CAD' },
    ])

    type Category = { category: string; total: Record<string, string>; childCount: number }

    // Top-level: expenses:food groups both subcategories, childCount should be 2
    const topRes = await request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(topRes.status).toBe(200)
    const top = (await topRes.json()) as { categories: Category[] }
    const foodCat = top.categories.find((c) => c.category === 'expenses:food')
    expect(foodCat?.childCount).toBe(2)

    // Drill-down: prefix=expenses:food returns the two subcategories as leaf nodes
    const drillRes = await request(
      '/api/reports/spending-summary?from=2025-01-01&to=2025-01-31&prefix=expenses:food',
      {
        headers: { Cookie: cookie },
      },
    )
    expect(drillRes.status).toBe(200)
    const drill = (await drillRes.json()) as { categories: Category[] }
    expect(drill.categories).toHaveLength(2)
    expect(drill.categories.every((c) => c.childCount === 0)).toBe(true)
  })

  it('GET /api/reports/spending-summary includes all expense postings from a multi-currency cross-currency-spend transaction', async () => {
    // Simulates a cross-currency spend: USD source, USD fee, CZK main spend.
    // Both expense postings must appear in the total — historically the frontend
    // only picked the first expense posting (the fee), missing the CZK spend.
    const source = await createAccount(cookie, 'assets:wise:usd')
    const equity = await createAccount(cookie, 'equity:conversions')
    const feeAcct = await createAccount(cookie, 'expenses:banking:fee')
    const expense = await createAccount(cookie, 'expenses:food:cafe')

    // Balanced: USD leg: -17.29 + 17.24 + 0.05 = 0; CZK leg: -360.00 + 360.00 = 0
    await createTransaction(cookie, '2025-01-15', 'Prague Coffee', [
      { accountId: source, amount: '-17.29', currency: 'USD' },
      { accountId: equity, amount: '17.24', currency: 'USD' },
      { accountId: feeAcct, amount: '0.05', currency: 'USD' },
      { accountId: equity, amount: '-360.00', currency: 'CZK' },
      { accountId: expense, amount: '360.00', currency: 'CZK' },
    ])

    type Category = { category: string; total: Record<string, string>; childCount: number }

    const res = await request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: Record<string, string>; categories: Category[] }

    // Both expense postings (CZK spend + USD fee) must be reflected in the total
    expect(body.total.CZK).toBe('360.00')
    expect(body.total.USD).toBe('0.05')

    const foodCat = body.categories.find((c) => c.category === 'expenses:food')
    expect(foodCat?.total.CZK).toBe('360.00')

    const bankingCat = body.categories.find((c) => c.category === 'expenses:banking')
    expect(bankingCat?.total.USD).toBe('0.05')
  })

  it('GET /api/reports/spending-summary excludes configured fee and conversion legs from the total', async () => {
    // Same well-formed cross-currency Wise spend, but this time the fee account is a
    // designated CSV-parser fee account and the equity account is the configured conversion
    // account. Both are mechanical — the spending total should count only the true cafe
    // spend (CZK 360), not the USD fee, and never the conversion leg.
    const source = await createAccount(cookie, 'assets:wise:usd')
    const equity = await createAccount(cookie, 'equity:conversions')
    const feeAcct = await createAccount(cookie, 'expenses:banking:fee')
    const expense = await createAccount(cookie, 'expenses:food:cafe')

    const userId = await getUserId(cookie)
    // Designate the conversion account in user settings…
    await db
      .update(userSettings)
      .set({ defaultConversionAccountId: equity })
      .where(eq(userSettings.userId, userId))
    // …and the fee account on a CSV parser.
    await db.insert(csvParsers).values({
      userId,
      name: 'Wise',
      normalizedHeader: 'amount|currency|date|description',
      columnMapping: { date: 'date', amount: 'amount' },
      isMultiCurrency: true,
      defaultFeeAccountId: feeAcct,
    })

    await createTransaction(cookie, '2025-01-15', 'Prague Coffee', [
      { accountId: source, amount: '-17.29', currency: 'USD' },
      { accountId: equity, amount: '17.24', currency: 'USD' },
      { accountId: feeAcct, amount: '0.05', currency: 'USD' },
      { accountId: equity, amount: '-360.00', currency: 'CZK' },
      { accountId: expense, amount: '360.00', currency: 'CZK' },
    ])

    type Category = { category: string; total: Record<string, string>; childCount: number }
    const res = await request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: Record<string, string>; categories: Category[] }

    // Only the real spend remains; the USD fee leg is gone from the total.
    expect(body.total.CZK).toBe('360.00')
    expect(body.total.USD).toBeUndefined()
    expect(body.categories.find((c) => c.category === 'expenses:banking')).toBeUndefined()
    expect(body.categories.find((c) => c.category === 'expenses:food')?.total.CZK).toBe('360.00')
  })

  // ── BUG-007 ───────────────────────────────────────────────
  //
  // The reports selected spend rows with `LIKE 'expenses:%'`, so a category at an
  // atypically-named root — tagged Expense on its own settings page, which is the one thing
  // the user can do about it — matched nothing. Every spend into it was absent from the
  // total, the breakdown and the trend, with no row to notice was missing.
  describe('a tagged category outside the expenses root', () => {
    type Category = { category: string; total: Record<string, string>; childCount: number }
    type Summary = { total: Record<string, string>; categories: Category[] }

    async function seedRent(): Promise<string> {
      const source = await createAccount(cookie, 'assets:chq')
      const rent = await createAccount(cookie, '花钱:房租')
      await setType(cookie, rent, 'expense')
      await createTransaction(cookie, '2025-01-15', 'Rent', [
        { accountId: source, amount: '-900.00', currency: 'CNY' },
        { accountId: rent, amount: '900.00', currency: 'CNY' },
      ])
      return rent
    }

    async function summary(qs: string): Promise<Summary> {
      const res = await request(`/api/reports/spending-summary${qs}`, {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(200)
      return (await res.json()) as Summary
    }

    it('is counted in the spending total and its own category', async () => {
      await seedRent()
      const body = await summary('?from=2025-01-01&to=2025-01-31')
      expect(body.total.CNY).toBe('900.00')
      expect(body.categories.find((cat) => cat.category === '花钱:房租')?.total.CNY).toBe('900.00')
    })

    it('is not counted while it carries no override', async () => {
      const source = await createAccount(cookie, 'assets:chq')
      const rent = await createAccount(cookie, '花钱:房租')
      await createTransaction(cookie, '2025-01-15', 'Rent', [
        { accountId: source, amount: '-900.00', currency: 'CNY' },
        { accountId: rent, amount: '900.00', currency: 'CNY' },
      ])
      const body = await summary('?from=2025-01-01&to=2025-01-31')
      expect(body.total).toEqual({})
    })

    it('leaves the total again when its override is cleared', async () => {
      const rent = await seedRent()
      await setType(cookie, rent, null)
      expect((await summary('?from=2025-01-01&to=2025-01-31')).total).toEqual({})
    })

    it('can be drilled into, which the root check used to refuse', async () => {
      const rent = await seedRent()
      const deeper = await createAccount(cookie, '花钱:房租:押金')
      await setType(cookie, deeper, 'expense')
      const source = await createAccount(cookie, 'assets:chq2')
      await createTransaction(cookie, '2025-01-16', 'Deposit', [
        { accountId: source, amount: '-100.00', currency: 'CNY' },
        { accountId: deeper, amount: '100.00', currency: 'CNY' },
      ])
      expect(rent).toBeDefined()

      const body = await summary('?from=2025-01-01&to=2025-01-31&prefix=花钱:房租')
      expect(body.categories.map((cat) => cat.category)).toEqual(
        expect.arrayContaining(['花钱:房租', '花钱:房租:押金']),
      )
    })

    it('still rejects a prefix that reaches no expense account', async () => {
      await seedRent()
      const res = await request(
        '/api/reports/spending-summary?from=2025-01-01&to=2025-01-31&prefix=assets:chq',
        { headers: { Cookie: cookie } },
      )
      expect(res.status).toBe(400)
    })

    it('appears in the monthly trend', async () => {
      const source = await createAccount(cookie, 'assets:chq')
      const rent = await createAccount(cookie, '花钱:房租')
      await setType(cookie, rent, 'expense')
      const today = new Date().toISOString().slice(0, 10)
      await createTransaction(cookie, today, 'Rent', [
        { accountId: source, amount: '-900.00', currency: 'CNY' },
        { accountId: rent, amount: '900.00', currency: 'CNY' },
      ])

      const res = await request('/api/reports/monthly-spend?months=1', {
        headers: { Cookie: cookie },
      })
      const body = (await res.json()) as { month: string; total: Record<string, string> }[]
      expect(at(body).total.CNY).toBe('900.00')
    })

    it('appears in the FX pairs the conversion needs', async () => {
      await seedRent()
      const res = await request(
        '/api/reports/spending-fx-pairs?from=2025-01-01&to=2025-01-31&targetCurrency=CAD',
        { headers: { Cookie: cookie } },
      )
      const body = (await res.json()) as { pairs: { date: string; from: string }[] }
      expect(body.pairs.map((pair) => pair.from)).toContain('CNY')
    })

    it('is counted by the converted total once its rate is cached', async () => {
      await seedRent()
      await db.insert(fxRates).values({
        date: '2025-01-15',
        baseCurrency: 'CNY',
        quoteCurrency: 'CAD',
        rate: '0.19',
      })
      const res = await request(
        '/api/reports/spending-converted?from=2025-01-01&to=2025-01-31&targetCurrency=CAD',
        { headers: { Cookie: cookie } },
      )
      const body = (await res.json()) as { total: string | null; missingCount: number }
      expect(body).toEqual({ total: '171.00', missingCount: 0 })
    })
  })

  it('drills into a path holding a LIKE metacharacter, itself and its children', async () => {
    // `_` is a single-character wildcard. Escaping it is right for the `LIKE '<prefix>:%'`
    // half and wrong for the `path = '<prefix>'` half, so escaping before the condition is
    // built drops the account sitting at exactly the prefix and keeps only its children.
    const source = await createAccount(cookie, 'assets:chq')
    const office = await createAccount(cookie, 'expenses:home_office')
    const desk = await createAccount(cookie, 'expenses:home_office:desk')
    // Deep enough to match an UNescaped `expenses:home_office:%`, which is the other half.
    const decoy = await createAccount(cookie, 'expenses:homeXoffice:chair')

    await createTransaction(cookie, '2025-01-15', 'Chair', [
      { accountId: source, amount: '-200.00', currency: 'CAD' },
      { accountId: office, amount: '200.00', currency: 'CAD' },
    ])
    await createTransaction(cookie, '2025-01-16', 'Desk', [
      { accountId: source, amount: '-300.00', currency: 'CAD' },
      { accountId: desk, amount: '300.00', currency: 'CAD' },
    ])
    await createTransaction(cookie, '2025-01-17', 'Decoy', [
      { accountId: source, amount: '-9.00', currency: 'CAD' },
      { accountId: decoy, amount: '9.00', currency: 'CAD' },
    ])

    const res = await request(
      '/api/reports/spending-summary?from=2025-01-01&to=2025-01-31&prefix=expenses:home_office',
      { headers: { Cookie: cookie } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: Record<string, string> }
    // 200 + 300, and not the 9 belonging to the account the wildcard would have swept in.
    expect(body.total.CAD).toBe('500.00')
  })

  // The override wins in both directions, or it does not mean anything.
  describe('the override against the path', () => {
    type Summary = { total: Record<string, string>; categories: { category: string }[] }

    async function summary(): Promise<Summary> {
      const res = await request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
        headers: { Cookie: cookie },
      })
      return (await res.json()) as Summary
    }

    it('counts a mis-pathed category under the assets root', async () => {
      const source = await createAccount(cookie, 'assets:chq')
      const groceries = await createAccount(cookie, 'assets:groceries')
      await setType(cookie, groceries, 'expense')
      await createTransaction(cookie, '2025-01-15', 'Groceries', [
        { accountId: source, amount: '-40.00', currency: 'CAD' },
        { accountId: groceries, amount: '40.00', currency: 'CAD' },
      ])
      expect((await summary()).total.CAD).toBe('40.00')
    })

    it('drops an account under the expenses root that is tagged an asset', async () => {
      const source = await createAccount(cookie, 'assets:chq')
      const holding = await createAccount(cookie, 'expenses:rrsp')
      await setType(cookie, holding, 'asset')
      await createTransaction(cookie, '2025-01-15', 'Contribution', [
        { accountId: source, amount: '-500.00', currency: 'CAD' },
        { accountId: holding, amount: '500.00', currency: 'CAD' },
      ])
      expect((await summary()).total).toEqual({})
    })

    it('still excludes a Fish Pie clearing leg, whatever it is tagged', async () => {
      // Selecting by type rather than by path root is what lets a tagged clearing account
      // reach these queries at all. It is a `share` leg, which is a role the old fee-and-
      // conversion id set could not express — the reason this runs the real classifier.
      //
      // Inserted directly: `POST /api/accounts` refuses the receivable namespace, and the
      // override is set the same way, so the API cannot build this shape. Fish Pie mints the
      // account itself, and its Type field is reachable from the account page like any other.
      const source = await createAccount(cookie, 'assets:chq')
      const userId = await getUserId(cookie)
      const clearing = returnedRow(
        await db
          .insert(accountsTable)
          .values({ userId, path: 'assets:receivable:alice', type: 'expense' })
          .returning({ id: accountsTable.id }),
        'insert clearing account',
      ).id

      await createTransaction(cookie, '2025-01-15', 'Split', [
        { accountId: source, amount: '-60.00', currency: 'CAD' },
        { accountId: clearing, amount: '60.00', currency: 'CAD' },
      ])
      expect((await summary()).total).toEqual({})
    })
  })

  // Decision #412: tagging the top of an atypical tree types the whole tree, so its untagged
  // categories are spending like any other.
  it('counts spend into an untagged category whose parent is tagged Expense', async () => {
    const source = await createAccount(cookie, 'assets:chq')
    const top = await createAccount(cookie, '花钱')
    const rent = await createAccount(cookie, '花钱:房租')
    await setType(cookie, top, 'expense')
    await createTransaction(cookie, '2025-01-15', 'Rent', [
      { accountId: source, amount: '-900.00', currency: 'CNY' },
      { accountId: rent, amount: '900.00', currency: 'CNY' },
    ])

    const res = await request('/api/reports/spending-summary?from=2025-01-01&to=2025-01-31', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as { total: Record<string, string> }
    expect(body.total.CNY).toBe('900.00')

    const listed = await request('/api/transactions?from=2025-01-01&to=2025-01-31&spending=true', {
      headers: { Cookie: cookie },
    })
    expect(((await listed.json()) as { description: string }[]).map((t) => t.description)).toEqual([
      'Rent',
    ])
  })

  // The spending page lists transactions beside the totals. It used to fetch them by the path
  // root of whichever category came first, so once the totals spanned two roots the list showed
  // one root's spending and the figure above it the sum of both.
  describe('GET /api/transactions?spending=true', () => {
    type Listed = { description: string | null }

    async function listed(qs: string): Promise<string[]> {
      const res = await request(`/api/transactions?from=2025-01-01&to=2025-01-31&${qs}`, {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(200)
      return ((await res.json()) as Listed[]).map((t) => t.description ?? '').sort()
    }

    it('lists spend at every root the totals count, and nothing that is not spend', async () => {
      const chq = await createAccount(cookie, 'assets:chq')
      const savings = await createAccount(cookie, 'assets:savings')
      const food = await createAccount(cookie, 'expenses:food')
      const rent = await createAccount(cookie, '花钱:房租')
      await setType(cookie, rent, 'expense')
      const salary = await createAccount(cookie, 'income:salary')

      await createTransaction(cookie, '2025-01-10', 'Lunch', [
        { accountId: chq, amount: '-20.00', currency: 'CAD' },
        { accountId: food, amount: '20.00', currency: 'CAD' },
      ])
      await createTransaction(cookie, '2025-01-15', 'Rent', [
        { accountId: chq, amount: '-900.00', currency: 'CAD' },
        { accountId: rent, amount: '900.00', currency: 'CAD' },
      ])
      await createTransaction(cookie, '2025-01-20', 'Payday', [
        { accountId: salary, amount: '-3000.00', currency: 'CAD' },
        { accountId: chq, amount: '3000.00', currency: 'CAD' },
      ])
      await createTransaction(cookie, '2025-01-25', 'Save', [
        { accountId: chq, amount: '-500.00', currency: 'CAD' },
        { accountId: savings, amount: '500.00', currency: 'CAD' },
      ])

      expect(await listed('spending=true')).toEqual(['Lunch', 'Rent'])
    })

    it('scopes the spend leg, not any leg, to the drilled-in path', async () => {
      const source = await createAccount(cookie, 'assets:wise:usd')
      const feeAcct = await createAccount(cookie, 'expenses:banking:fee')
      const cafe = await createAccount(cookie, 'expenses:food:cafe')
      const atm = await createAccount(cookie, 'expenses:banking:atm')
      await db.insert(csvParsers).values({
        userId: await getUserId(cookie),
        name: 'Wise',
        normalizedHeader: 'amount|currency|date|description',
        columnMapping: { date: 'date', amount: 'amount' },
        isMultiCurrency: true,
        defaultFeeAccountId: feeAcct,
      })

      // A coffee whose only leg under `expenses:banking` is the designated fee.
      await createTransaction(cookie, '2025-01-15', 'Coffee', [
        { accountId: source, amount: '-5.05', currency: 'USD' },
        { accountId: feeAcct, amount: '0.05', currency: 'USD' },
        { accountId: cafe, amount: '5.00', currency: 'USD' },
      ])
      await createTransaction(cookie, '2025-01-16', 'ATM charge', [
        { accountId: source, amount: '-3.00', currency: 'USD' },
        { accountId: atm, amount: '3.00', currency: 'USD' },
      ])

      // Any leg: the fee drags the coffee in, which is what the list did before.
      expect(await listed('accountPath=expenses:banking')).toEqual(['ATM charge', 'Coffee'])
      // Spend legs only: the banking figure is the ATM charge, and so is its list.
      expect(await listed('accountPath=expenses:banking&spending=true')).toEqual(['ATM charge'])
      expect(await listed('accountPath=expenses:food&spending=true')).toEqual(['Coffee'])
    })

    it('rejects a value that is not true', async () => {
      const res = await request('/api/transactions?spending=yes', { headers: { Cookie: cookie } })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('FIELD_NOT_BOOLEAN')
    })
  })

  // The list's `accountPath` filter escaped its own LIKE pattern until it moved onto
  // `underPathCondition`; this holds both halves of what the escaping has to get right.
  it('GET /api/transactions?accountPath= matches the path and its children, not a wildcard', async () => {
    const source = await createAccount(cookie, 'assets:chq')
    const office = await createAccount(cookie, 'expenses:home_office')
    const desk = await createAccount(cookie, 'expenses:home_office:desk')
    const decoy = await createAccount(cookie, 'expenses:homeXoffice:chair')
    for (const [description, accountId] of [
      ['Office', office],
      ['Desk', desk],
      ['Decoy', decoy],
    ] as const) {
      await createTransaction(cookie, '2025-01-15', description, [
        { accountId: source, amount: '-1.00', currency: 'CAD' },
        { accountId, amount: '1.00', currency: 'CAD' },
      ])
    }

    const res = await request('/api/transactions?accountPath=expenses:home_office', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as { description: string | null }[]
    expect(body.map((t) => t.description).sort()).toEqual(['Desk', 'Office'])
  })

  it('GET /api/reports/monthly-spend returns one entry per month with empty totals when there are no transactions', async () => {
    const res = await request('/api/reports/monthly-spend?months=3', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { month: string; total: Record<string, string> }[]
    expect(body).toHaveLength(3)
    // All entries should have empty totals
    expect(body.every((entry) => Object.keys(entry.total).length === 0)).toBe(true)
    // Months should be in ascending order
    expect(at(body).month < at(body, 1).month).toBe(true)
    expect(at(body, 1).month < at(body, 2).month).toBe(true)
  })
})
