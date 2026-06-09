import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { groupExpenses, groupExpenseSplits, transactions } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'

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
})
