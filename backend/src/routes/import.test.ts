import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

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
