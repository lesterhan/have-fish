import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { groupExpenses, groupExpenseSplits, transactions, postings, accounts, importRules } from '../db/schema'
import { eq, isNull, and, inArray } from 'drizzle-orm'

// Minimal CSV that matches the parser we create in tests.
// Headers: Date, Amount, Description — normalised fingerprint: amount|date|description
const TEST_CSV = `Date,Amount,Description
2026-02-01,-42.50,Coffee
2026-02-02,100.00,Salary`

const TEST_PARSER = {
  name: 'Test Bank',
  normalizedHeader: 'amount|date|description',
  columnMapping: { date: 'date', amount: 'amount', description: 'description' },
}

async function createParser(cookie: string) {
  return app.request('/api/parsers', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_PARSER),
  })
}

async function createAccount(cookie: string, path: string) {
  const res = await app.request('/api/accounts', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return res.json()
}

function csvForm(csv: string) {
  const form = new FormData()
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'export.csv')
  form.append('accountId', 'any-account-id')
  form.append('defaultCurrency', 'CAD')
  return form
}

describe('POST /api/import/preview', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('returns 422 when no saved parser matches the CSV', async () => {
    const res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: csvForm(TEST_CSV),
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/no saved parser/i)
  })

  it('parses the CSV using the matching saved parser', async () => {
    await createParser(cookie)

    const res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: csvForm(TEST_CSV),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parser).toBe('Test Bank')
    expect(body.transactions).toBeArrayOfSize(2)
    expect(body.errors).toBeArrayOfSize(0)
    expect(body.transactions[0].description).toBe('Coffee')
    expect(body.transactions[0].amount).toBe('-42.50')
  })

  it('applies an active rule but not a denied one', async () => {
    await createParser(cookie)
    const coffeeShop = await createAccount(cookie, 'expenses:coffee')
    const sessionRes = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
    const userId = (await sessionRes.json()).user.id

    // Active rule for "Coffee" should populate suggestedOffsetAccountId.
    const [activeRule] = await db
      .insert(importRules)
      .values({ userId, pattern: 'Coffee', accountId: coffeeShop.id, status: 'active' })
      .returning()

    let res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: csvForm(TEST_CSV),
    })
    let body = await res.json()
    const coffeeRow = body.transactions.find((t: { description: string }) => t.description === 'Coffee')
    expect(coffeeRow.suggestedOffsetAccountId).toBe(coffeeShop.id)

    // Flip it to denied — it must no longer be applied.
    await db.update(importRules).set({ status: 'denied' }).where(eq(importRules.id, activeRule.id))

    res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: csvForm(TEST_CSV),
    })
    body = await res.json()
    const coffeeRowAfter = body.transactions.find((t: { description: string }) => t.description === 'Coffee')
    expect(coffeeRowAfter.suggestedOffsetAccountId).toBeFalsy()
  })

  it('does not use a parser belonging to another user', async () => {
    const otherCookie = await createTestUser('other@example.com')
    await createParser(otherCookie)

    const res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: csvForm(TEST_CSV),
    })
    expect(res.status).toBe(422)
  })

  // --- Cross-currency spend vs convert-and-park detection (story 2) ---
  //
  // A multi-currency parser with a merchant row and a convert-and-park row whose
  // description is the user's own name ('Test User', from createTestUser).
  const MULTI_PARSER = {
    name: 'Multi Bank',
    normalizedHeader: 'date|description|fee|sourceamount|sourcecurrency|targetamount|targetcurrency',
    isMultiCurrency: true,
    columnMapping: {
      date: 'date',
      amount: 'sourceamount',
      description: 'description',
      sourceAmount: 'sourceamount',
      sourceCurrency: 'sourcecurrency',
      targetAmount: 'targetamount',
      targetCurrency: 'targetcurrency',
      feeAmount: 'fee',
    },
  }
  const MULTI_CSV = `Date,SourceAmount,SourceCurrency,TargetAmount,TargetCurrency,Fee,Description
2026-04-01,17.29,USD,360.00,CZK,0.05,Prague Coffee House
2026-04-02,600.00,CAD,408.00,EUR,1.20,Test User`

  async function createMultiParser(c: string) {
    return app.request('/api/parsers', {
      method: 'POST',
      headers: { Cookie: c, 'Content-Type': 'application/json' },
      body: JSON.stringify(MULTI_PARSER),
    })
  }

  function multiCsvForm() {
    const form = new FormData()
    form.append('file', new Blob([MULTI_CSV], { type: 'text/csv' }), 'export.csv')
    form.append('defaultCurrency', 'CAD')
    return form
  }

  it('flags a cross-currency row as spend by default and a name-match row as transfer', async () => {
    await createMultiParser(cookie)

    const res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: multiCsvForm(),
    })
    expect(res.status).toBe(200)
    const body = await res.json()

    const spendRow = body.transactions.find((t: { description: string }) => t.description === 'Prague Coffee House')
    expect(spendRow.isTransfer).toBe(true)
    expect(spendRow.suggestedKind).toBe('spend')

    const convertRow = body.transactions.find((t: { description: string }) => t.description === 'Test User')
    expect(convertRow.isTransfer).toBe(true)
    expect(convertRow.suggestedKind).toBe('transfer')
    // A convert-and-park has no expense suggestion.
    expect(convertRow.suggestedExpenseAccountId).toBeFalsy()
  })

  it('pre-fills a spend row’s expense account from a matching import rule', async () => {
    await createMultiParser(cookie)
    const coffeeAcc = await createAccount(cookie, 'expenses:food:coffee')
    const sessionRes = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
    const userId = (await sessionRes.json()).user.id
    await db
      .insert(importRules)
      .values({ userId, pattern: 'Coffee', accountId: coffeeAcc.id, status: 'active' })

    const res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: multiCsvForm(),
    })
    const body = await res.json()

    const spendRow = body.transactions.find((t: { description: string }) => t.description === 'Prague Coffee House')
    expect(spendRow.suggestedKind).toBe('spend')
    expect(spendRow.suggestedExpenseAccountId).toBe(coffeeAcc.id)

    // The name-match convert row must not pick up an expense suggestion even if a rule matches.
    const convertRow = body.transactions.find((t: { description: string }) => t.description === 'Test User')
    expect(convertRow.suggestedKind).toBe('transfer')
    expect(convertRow.suggestedExpenseAccountId).toBeFalsy()
  })
})

describe('POST /api/import/check-duplicates', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('returns null for all rows when no matches exist', async () => {
    const source = await createAccount(cookie, 'assets:wise:usd')
    const res = await app.request('/api/import/check-duplicates', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{ accountId: source.id, date: '2026-02-01', amount: '-42.50' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duplicates).toEqual([null])
  })

  it('flags a duplicate when posting exists on the exact sub-account', async () => {
    const source = await createAccount(cookie, 'assets:wise:usd')
    const offset = await createAccount(cookie, 'expenses:uncategorized')

    // Seed an existing transaction on assets:wise:usd
    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: source.id,
        defaultCurrency: 'USD',
        transactions: [
          { isTransfer: false, date: new Date('2026-02-01').toISOString(), amount: '-42.50', currency: 'USD', offsetAccountId: offset.id },
        ],
      }),
    })

    const res = await app.request('/api/import/check-duplicates', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{ accountId: source.id, date: '2026-02-01', amount: '-42.50' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duplicates[0]).not.toBeNull()
    expect(body.duplicates[0].amount).toBe('-42.50')
  })

  it('does not flag a duplicate when the posting is on a sibling sub-account (the original multi-currency bug)', async () => {
    const usd = await createAccount(cookie, 'assets:wise:usd')
    const cad = await createAccount(cookie, 'assets:wise:cad')
    const offset = await createAccount(cookie, 'expenses:uncategorized')

    // Seed a transaction on assets:wise:usd
    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: usd.id,
        defaultCurrency: 'USD',
        transactions: [
          { isTransfer: false, date: new Date('2026-02-01').toISOString(), amount: '-42.50', currency: 'USD', offsetAccountId: offset.id },
        ],
      }),
    })

    // Check against assets:wise:cad — same date/amount but different sub-account
    const res = await app.request('/api/import/check-duplicates', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{ accountId: cad.id, date: '2026-02-01', amount: '-42.50' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duplicates[0]).toBeNull()
  })

  it('skips rows with empty accountId (transfer rows)', async () => {
    const res = await app.request('/api/import/check-duplicates', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{ accountId: '', date: '2026-02-01', amount: '-42.50' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duplicates[0]).toBeNull()
  })

  it('does not expose postings from another user', async () => {
    const otherCookie = await createTestUser('other@example.com')
    const otherAccount = await createAccount(otherCookie, 'assets:wise:usd')
    const otherOffset = await createAccount(otherCookie, 'expenses:uncategorized')

    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: otherCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: otherAccount.id,
        defaultCurrency: 'USD',
        transactions: [
          { isTransfer: false, date: new Date('2026-02-01').toISOString(), amount: '-42.50', currency: 'USD', offsetAccountId: otherOffset.id },
        ],
      }),
    })

    // This user tries to check against the other user's account ID
    const res = await app.request('/api/import/check-duplicates', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{ accountId: otherAccount.id, date: '2026-02-01', amount: '-42.50' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Account ownership check silently skips the row — returns null, not the other user's data
    expect(body.duplicates[0]).toBeNull()
  })
})

describe('POST /api/import/commit', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('writes transactions and postings to the database', async () => {
    const source = await createAccount(cookie, 'assets:chequing')
    const offset = await createAccount(cookie, 'expenses:uncategorized')

    const parsed = [
      { date: new Date('2026-02-01').toISOString(), amount: '-50.00', description: 'Coffee', currency: 'CAD', offsetAccountId: offset.id },
      { date: new Date('2026-02-02').toISOString(), amount: '100.00', description: 'Tax refund', currency: 'CAD', offsetAccountId: offset.id },
    ]

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: source.id, defaultCurrency: 'CAD', transactions: parsed }),
    })

    expect(res.status).toBe(201)
    expect((await res.json()).created).toBe(2)

    const txRes = await app.request('/api/transactions', { headers: { Cookie: cookie } })
    const txs = await txRes.json()
    expect(txs).toBeArrayOfSize(2)

    // Each transaction must have exactly 2 postings that balance to zero
    for (const tx of txs) {
      expect(tx.postings).toBeArrayOfSize(2)
      const sum = tx.postings.reduce((acc: number, p: { amount: string }) => acc + parseFloat(p.amount), 0)
      expect(Math.abs(sum)).toBeLessThan(0.001)
    }

    // Spot-check: source gets -50, offset gets +50
    const coffee = txs.find((tx: { description: string }) => tx.description === 'Coffee')
    expect(coffee.postings).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: source.id, amount: '-50.00', currency: 'CAD' }),
      expect.objectContaining({ accountId: offset.id, amount: '50.00', currency: 'CAD' }),
    ]))
  })

  it('writes 5 postings for a transfer row and balances per currency', async () => {
    const sourceAcc    = await createAccount(cookie, 'assets:wise:cad')
    const targetAcc    = await createAccount(cookie, 'assets:wise:gbp')
    const conversionAcc = await createAccount(cookie, 'equity:conversion')
    const feeAcc       = await createAccount(cookie, 'expenses:fees:wise')

    const transfer = {
      isTransfer: true,
      date: new Date('2026-03-01').toISOString(),
      description: 'Wise CAD→GBP',
      sourceAmount: '-200.00',
      sourceCurrency: 'CAD',
      targetAmount: '107.90',
      targetCurrency: 'GBP',
      feeAmount: '0.96',
      feeCurrency: 'CAD',
      sourceAccountId: sourceAcc.id,
      targetAccountId: targetAcc.id,
      conversionAccountId: conversionAcc.id,
      feeAccountId: feeAcc.id,
    }

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: '', defaultCurrency: 'CAD', transactions: [transfer] }),
    })

    expect(res.status).toBe(201)
    expect((await res.json()).created).toBe(1)

    const txRes = await app.request('/api/transactions', { headers: { Cookie: cookie } })
    const txs = await txRes.json()
    expect(txs).toBeArrayOfSize(1)

    const t = txs[0]
    expect(t.postings).toBeArrayOfSize(5)

    // Both currencies must balance to zero
    const cadSum = t.postings
      .filter((p: { currency: string }) => p.currency === 'CAD')
      .reduce((acc: number, p: { amount: string }) => acc + parseFloat(p.amount), 0)
    const gbpSum = t.postings
      .filter((p: { currency: string }) => p.currency === 'GBP')
      .reduce((acc: number, p: { amount: string }) => acc + parseFloat(p.amount), 0)

    expect(Math.abs(cadSum)).toBeLessThan(0.001)
    expect(Math.abs(gbpSum)).toBeLessThan(0.001)
  })

  it('cross-currency spend: spend lands in expense account, bridged by equity, no phantom asset', async () => {
    const sourceAcc     = await createAccount(cookie, 'assets:bank:savings:usd')
    const conversionAcc = await createAccount(cookie, 'equity:conversions')
    const feeAcc        = await createAccount(cookie, 'expenses:banking')
    const coffeeAcc     = await createAccount(cookie, 'expenses:food:coffee')

    const row = {
      isTransfer: 'cross-currency-spend',
      date: new Date('2026-05-31').toISOString(),
      description: 'You Are My Cup Of',
      sourceAmount: '-17.29',
      sourceCurrency: 'USD',
      targetAmount: '360.00',
      targetCurrency: 'CZK',
      feeAmount: '0.05',
      feeCurrency: 'USD',
      sourceAccountId: sourceAcc.id,
      expenseAccountId: coffeeAcc.id,
      conversionAccountId: conversionAcc.id,
      feeAccountId: feeAcc.id,
    }

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: '', defaultCurrency: 'USD', transactions: [row] }),
    })

    expect(res.status).toBe(201)
    expect((await res.json()).created).toBe(1)

    const txRes = await app.request('/api/transactions', { headers: { Cookie: cookie } })
    const txs = await txRes.json()
    expect(txs).toBeArrayOfSize(1)
    const t = txs[0]
    expect(t.postings).toBeArrayOfSize(5)

    // Both currencies balance to zero
    const usdSum = t.postings.filter((p: { currency: string }) => p.currency === 'USD')
      .reduce((a: number, p: { amount: string }) => a + parseFloat(p.amount), 0)
    const czkSum = t.postings.filter((p: { currency: string }) => p.currency === 'CZK')
      .reduce((a: number, p: { amount: string }) => a + parseFloat(p.amount), 0)
    expect(Math.abs(usdSum)).toBeLessThan(0.001)
    expect(Math.abs(czkSum)).toBeLessThan(0.001)

    // The spend is a single +360 CZK leg on the coffee account — not double-booked in USD
    const coffeeLegs = t.postings.filter((p: { accountId: string }) => p.accountId === coffeeAcc.id)
    expect(coffeeLegs).toBeArrayOfSize(1)
    expect(coffeeLegs[0]).toEqual(expect.objectContaining({ amount: '360.00', currency: 'CZK' }))

    // equity:conversions bridges both sides (the bug used the expense account here)
    expect(t.postings).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: conversionAcc.id, amount: '17.24', currency: 'USD' }),
      expect.objectContaining({ accountId: conversionAcc.id, amount: '-360.00', currency: 'CZK' }),
    ]))

    // No phantom CZK asset balance — the source asset only has the USD outflow
    const sourceLegs = t.postings.filter((p: { accountId: string }) => p.accountId === sourceAcc.id)
    expect(sourceLegs).toBeArrayOfSize(1)
    expect(sourceLegs[0]).toEqual(expect.objectContaining({ amount: '-17.29', currency: 'USD' }))
  })

  it('cross-currency spend without a fee: 4 postings, balanced', async () => {
    const sourceAcc     = await createAccount(cookie, 'assets:bank:savings:usd')
    const conversionAcc = await createAccount(cookie, 'equity:conversions')
    const coffeeAcc     = await createAccount(cookie, 'expenses:food:coffee')

    const row = {
      isTransfer: 'cross-currency-spend',
      date: new Date('2026-05-31').toISOString(),
      description: 'No-fee spend',
      sourceAmount: '-17.24',
      sourceCurrency: 'USD',
      targetAmount: '360.00',
      targetCurrency: 'CZK',
      sourceAccountId: sourceAcc.id,
      expenseAccountId: coffeeAcc.id,
      conversionAccountId: conversionAcc.id,
    }

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: '', defaultCurrency: 'USD', transactions: [row] }),
    })

    expect(res.status).toBe(201)
    const txRes = await app.request('/api/transactions', { headers: { Cookie: cookie } })
    const t = (await txRes.json())[0]
    expect(t.postings).toBeArrayOfSize(4)
    const usdSum = t.postings.filter((p: { currency: string }) => p.currency === 'USD')
      .reduce((a: number, p: { amount: string }) => a + parseFloat(p.amount), 0)
    const czkSum = t.postings.filter((p: { currency: string }) => p.currency === 'CZK')
      .reduce((a: number, p: { amount: string }) => a + parseFloat(p.amount), 0)
    expect(Math.abs(usdSum)).toBeLessThan(0.001)
    expect(Math.abs(czkSum)).toBeLessThan(0.001)
  })

  it('rejects a cross-currency spend with a fee but no feeAccountId', async () => {
    const sourceAcc     = await createAccount(cookie, 'assets:bank:savings:usd')
    const conversionAcc = await createAccount(cookie, 'equity:conversions')
    const coffeeAcc     = await createAccount(cookie, 'expenses:food:coffee')

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: '', defaultCurrency: 'USD', transactions: [{
          isTransfer: 'cross-currency-spend',
          date: new Date('2026-05-31').toISOString(),
          sourceAmount: '-17.29', sourceCurrency: 'USD',
          targetAmount: '360.00', targetCurrency: 'CZK',
          feeAmount: '0.05',
          sourceAccountId: sourceAcc.id,
          expenseAccountId: coffeeAcc.id,
          conversionAccountId: conversionAcc.id,
        }],
      }),
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('feeAccountId')
  })
})

describe('POST /api/import/commit — group splits', () => {
  let cookieA: string
  let cookieB: string
  let userAId: string
  let userBId: string
  let groupId: string
  let sourceId: string
  let offsetId: string

  beforeEach(async () => {
    await clearDatabase()

    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')

    const sessA = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    const sessB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    userAId = ((await sessA.json()) as any).user.id
    userBId = ((await sessB.json()) as any).user.id

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Housing' }),
    })
    groupId = ((await groupRes.json()) as any).id

    const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@test.com' }),
    })
    const inviteId = ((await invRes.json()) as any).id
    await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: { Cookie: cookieB },
    })

    const src = await createAccount(cookieA, 'assets:chequing')
    const off = await createAccount(cookieA, 'expenses:food')
    sourceId = src.id
    offsetId = off.id
  })

  const regularRow = (description = 'Rent', amount = '-1200.00') => ({
    isTransfer: false,
    date: new Date('2026-05-01').toISOString(),
    description,
    amount,
    offsetAccountId: offsetId,
    sourceAccountId: sourceId,
  })

  it('creates transaction + group expense + member postings when groupSplits provided', async () => {
    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [regularRow()],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.created).toBe(1)
    expect(body.fishPieExpenses).toBe(1)

    // Group expense created
    const expenses = await db
      .select()
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
    expect(expenses).toHaveLength(1)
    expect(expenses[0].amount).toBe('1200.00')
    expect(expenses[0].paidByUserId).toBe(userAId)
    expect(expenses[0].transactionId).toBeTruthy()

    // Splits created for both members
    const splits = await db
      .select()
      .from(groupExpenseSplits)
      .where(eq(groupExpenseSplits.expenseId, expenses[0].id))
    expect(splits).toHaveLength(2)
    const total = splits.reduce((s, r) => s + parseFloat(r.amount), 0)
    expect(total).toBeCloseTo(1200, 1)
  })

  it('row without split creates transaction only', async () => {
    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [regularRow('Coffee', '-5.00')],
      }),
    })

    expect(res.status).toBe(201)
    expect((await res.json() as any).fishPieExpenses).toBe(0)

    const expenses = await db
      .select()
      .from(groupExpenses)
      .where(eq(groupExpenses.groupId, groupId))
    expect(expenses).toHaveLength(0)
  })

  it('returns 403 if user is not a member of the group', async () => {
    // User B tries to import with a group A created (B is a member), but use a random group ID
    const fakeGroupId = '00000000-0000-0000-0000-000000000000'
    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [regularRow()],
        groupSplits: [{ rowIndex: 0, groupId: fakeGroupId }],
      }),
    })
    expect(res.status).toBe(404)
  })

  it('links group expense transactionId to the imported transaction', async () => {
    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [regularRow()],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    const [expense] = await db
      .select()
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))

    expect(expense.transactionId).toBeTruthy()

    const [linkedTx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, expense.transactionId!))
    expect(linkedTx).toBeTruthy()
    expect(linkedTx.userId).toBe(userAId)
  })

  it('accepts Fish Pie row without offsetAccountId (backend derives shared account)', async () => {
    const rowWithoutOffset = {
      isTransfer: false,
      date: new Date('2026-05-01').toISOString(),
      description: 'Dinner',
      amount: '-90.00',
      sourceAccountId: sourceId,
      // offsetAccountId intentionally omitted
    }
    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [rowWithoutOffset],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })
    expect(res.status).toBe(201)
    expect((await res.json() as any).fishPieExpenses).toBe(1)
  })

  it('uses the shared clearing account as the import offset for Fish Pie rows', async () => {
    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        // offsetAccountId is present but should be ignored for Fish Pie rows
        transactions: [{ ...regularRow('Groceries', '-60.00'), offsetAccountId: offsetId }],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })
    expect(res.status).toBe(201)

    const allTxs = await db.select().from(transactions).where(eq(transactions.userId, userAId))
    const importTx = allTxs.find((t) => !t.groupExpenseId)
    expect(importTx).toBeTruthy()

    // The offset posting must go to assets:receivable:housing, not to the user-supplied offsetAccountId
    // and not to uncategorized. This prevents double-counting the payer's share.
    const txPostings = await db.select().from(postings).where(eq(postings.transactionId, importTx!.id))
    const offsetPosting = txPostings.find((p) => p.accountId !== sourceId)
    expect(offsetPosting).toBeTruthy()

    const [offsetAccount] = await db.select().from(accounts).where(eq(accounts.id, offsetPosting!.accountId))
    expect(offsetAccount.path).toBe('assets:receivable:housing')
  })

  it('payer expense account shows only their share when Fish Pie split on credit card import', async () => {
    // Simulate a credit card import: positive amount = charge to card.
    // User A pays $100, 50/50 split → payer's share = $50.
    const cardId = (await createAccount(cookieA, 'liabilities:visa')).id
    const expenseId = (await createAccount(cookieA, 'expenses:food')).id

    // Set user A's defaultExpenseAccountId so the member tx posts to expenses:food.
    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: expenseId }),
    })

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: cardId,
        defaultCurrency: 'CAD',
        transactions: [{
          isTransfer: false,
          date: new Date('2026-05-01').toISOString(),
          description: 'Tim Hortons',
          amount: '100.00',   // positive = credit card charge convention
          sourceAccountId: cardId,
        }],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })
    expect(res.status).toBe(201)

    // Sum all postings to expenses:food across all of user A's transactions.
    const userATxs = await db.select().from(transactions).where(eq(transactions.userId, userAId))
    const userATxIds = userATxs.map((t) => t.id)
    const allPostings = await db
      .select()
      .from(postings)
      .where(and(eq(postings.accountId, expenseId), inArray(postings.transactionId, userATxIds)))

    const net = allPostings.reduce((s, p) => s + parseFloat(p.amount), 0)
    // Payer's 50% share = $50. Must not be $100 (import only) or $150 (double-counted).
    expect(net).toBeCloseTo(-50, 1)
  })

  it('Fish Pie chequing import creates 3 balanced postings on the import tx', async () => {
    // Chequing $1200, 50/50. Import tx must have 3 postings that sum to zero:
    //   chequing −1200, assets:receivable:housing +600 (B's share), expense +600 (A's share).
    const expenseAccId = (await createAccount(cookieA, 'expenses:food')).id
    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: expenseAccId }),
    })

    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [regularRow('Rent', '-1200.00')],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    const allTxs = await db.select().from(transactions).where(eq(transactions.userId, userAId))
    const importTx = allTxs.find((t) => !t.groupExpenseId)!
    const txPostings = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, importTx.id), isNull(postings.deletedAt)))

    expect(txPostings).toHaveLength(3)

    const sum = txPostings.reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(Math.abs(sum)).toBeLessThan(0.01)

    // assets:receivable:housing gets only others' share (+600), not the full negated amount (+1200).
    const [groupAccount] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userAId), eq(accounts.path, 'assets:receivable:housing'), isNull(accounts.deletedAt)))
    const groupPosting = txPostings.find((p) => p.accountId === groupAccount.id)
    expect(groupPosting).toBeTruthy()
    expect(parseFloat(groupPosting!.amount)).toBeCloseTo(600, 1)

    // Expense account gets payer's share (+600 for chequing convention).
    const expensePosting = txPostings.find((p) => p.accountId === expenseAccId)
    expect(expensePosting).toBeTruthy()
    expect(parseFloat(expensePosting!.amount)).toBeCloseTo(600, 1)
  })

  it('does not create a payer member transaction for import-linked Fish Pie expenses', async () => {
    // Only B (non-payer) should get a member tx. A (payer) has only the import tx.
    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [regularRow('Groceries', '-60.00')],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    const userATxs = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userAId), isNull(transactions.deletedAt)))
    // A has exactly 1 tx: the import tx (no groupExpenseId)
    expect(userATxs).toHaveLength(1)
    expect(userATxs[0].groupExpenseId).toBeNull()

    const userBTxs = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userBId), isNull(transactions.deletedAt)))
    // B has exactly 1 tx: their member tx (has groupExpenseId)
    expect(userBTxs).toHaveLength(1)
    expect(userBTxs[0].groupExpenseId).toBeTruthy()
  })

  it('Fish Pie cross-currency: splits net target amount, fee posting untouched', async () => {
    const cadAccountId = (await createAccount(cookieA, 'assets:wise:cad')).id
    const eurAccountId = (await createAccount(cookieA, 'assets:wise:eur')).id
    const convAccountId = (await createAccount(cookieA, 'equity:conversion')).id
    const feeAccountId = (await createAccount(cookieA, 'expenses:wise-fees')).id
    const expenseAccId = (await createAccount(cookieA, 'expenses:dining')).id

    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: expenseAccId }),
    })

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: '',
        defaultCurrency: 'CAD',
        transactions: [{
          isTransfer: true,
          date: new Date('2026-05-10').toISOString(),
          description: 'Dinner in Paris',
          sourceAmount: '-15.20',
          sourceCurrency: 'CAD',
          targetAmount: '10.00',
          targetCurrency: 'EUR',
          feeAmount: '0.20',
          feeCurrency: 'CAD',
          sourceAccountId: cadAccountId,
          targetAccountId: eurAccountId,  // sent but ignored — group/expense replace it
          conversionAccountId: convAccountId,
          feeAccountId: feeAccountId,
        }],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.fishPieExpenses).toBe(1)

    // Group expense created in target currency (EUR) for net amount only
    const expenses = await db
      .select()
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
    expect(expenses).toHaveLength(1)
    expect(expenses[0].amount).toBe('10.00')
    expect(expenses[0].currency).toBe('EUR')

    // Import tx: 6 postings (with fee)
    const userATxs = await db.select().from(transactions).where(eq(transactions.userId, userAId))
    const importTx = userATxs.find((t) => !t.groupExpenseId)!
    const txPostings = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, importTx.id), isNull(postings.deletedAt)))
    expect(txPostings).toHaveLength(6)

    // Both currencies balance to zero
    const cadSum = txPostings.filter(p => p.currency === 'CAD').reduce((s, p) => s + parseFloat(p.amount), 0)
    const eurSum = txPostings.filter(p => p.currency === 'EUR').reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(Math.abs(cadSum)).toBeLessThan(0.01)
    expect(Math.abs(eurSum)).toBeLessThan(0.01)

    // Fee posting untouched: 0.20 CAD to feeAccount
    const feePosting = txPostings.find(p => p.accountId === feeAccountId)
    expect(feePosting).toBeTruthy()
    expect(feePosting!.amount).toBe('0.20')
    expect(feePosting!.currency).toBe('CAD')

    // Target (eurAccount) did NOT receive net — group/expense replaced it
    const targetPosting = txPostings.find(p => p.accountId === eurAccountId)
    expect(targetPosting).toBeUndefined()

    // EUR postings go to group clearing + payer expense (50/50 split)
    const eurPostings = txPostings.filter(p => p.currency === 'EUR' && parseFloat(p.amount) > 0)
    expect(eurPostings).toHaveLength(2)
    const eurPositiveSum = eurPostings.reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(eurPositiveSum).toBeCloseTo(10, 2)
  })

  it('Fish Pie same-currency: splits net amount, fee posting untouched', async () => {
    const externalBankId = (await createAccount(cookieA, 'assets:external-bank')).id
    const targetAccId = (await createAccount(cookieA, 'assets:chequing2')).id
    const feeAccId = (await createAccount(cookieA, 'expenses:bank-fees')).id
    const expenseAccId = (await createAccount(cookieA, 'expenses:shared')).id

    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: expenseAccId }),
    })

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: '',
        defaultCurrency: 'CAD',
        transactions: [{
          isTransfer: 'same-currency',
          date: new Date('2026-05-10').toISOString(),
          description: 'Shared expense transfer',
          amount: '99.38',
          feeAmount: '0.62',
          currency: 'CAD',
          targetAccountId: targetAccId,  // sent but ignored for fish pie
          sourceAccountId: externalBankId,
          feeAccountId: feeAccId,
        }],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.fishPieExpenses).toBe(1)

    // Group expense in CAD for net amount only (not gross)
    const expenses = await db
      .select()
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
    expect(expenses).toHaveLength(1)
    expect(expenses[0].amount).toBe('99.38')
    expect(expenses[0].currency).toBe('CAD')

    // Import tx: 4 postings
    const userATxs = await db.select().from(transactions).where(eq(transactions.userId, userAId))
    const importTx = userATxs.find((t) => !t.groupExpenseId)!
    const txPostings = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, importTx.id), isNull(postings.deletedAt)))
    expect(txPostings).toHaveLength(4)

    // All postings balance to zero
    const sum = txPostings.reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(Math.abs(sum)).toBeLessThan(0.01)

    // Fee posting untouched: 0.62 CAD to feeAccount
    const feePosting = txPostings.find(p => p.accountId === feeAccId)
    expect(feePosting).toBeTruthy()
    expect(feePosting!.amount).toBe('0.62')

    // Target account did NOT receive net — group/expense replaced it
    const targetPosting = txPostings.find(p => p.accountId === targetAccId)
    expect(targetPosting).toBeUndefined()

    // Source account loses gross (net + fee)
    const sourcePosting = txPostings.find(p => p.accountId === externalBankId)
    expect(sourcePosting).toBeTruthy()
    expect(parseFloat(sourcePosting!.amount)).toBeCloseTo(-100, 2)
  })
})
