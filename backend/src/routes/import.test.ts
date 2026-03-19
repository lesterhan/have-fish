import { describe, it, expect, beforeEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'

async function createAccount(cookie: string, path: string) {
  const res = await app.request('/api/accounts', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return res.json()
}

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, '../import/fixtures', name), 'utf-8')

describe('POST /api/import/preview', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('parses a WealthSimple CSV and returns transactions', async () => {
    const form = new FormData()
    form.append('file', new Blob([fixture('ws-sample.csv')], { type: 'text/csv' }), 'ws-sample.csv')
    form.append('accountId', 'some-account-id')
    form.append('defaultCurrency', 'CAD')

    const res = await app.request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transactions).toBeArray()
    expect(body.transactions.length).toBeGreaterThan(0)
    expect(body.errors).toBeArray()
  })
})

describe('POST /api/import/commit', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('writes transactions and postings to the database', async () => {
    const source = await createAccount(cookie, 'assets:ws:cad')
    const offset = await createAccount(cookie, 'expenses:uncategorized')

    const parsed = [
      { date: new Date('2026-02-01').toISOString(), amount: '-50.00', description: 'Coffee', currency: 'CAD' },
      { date: new Date('2026-02-02').toISOString(), amount: '100.00', description: 'Tax refund', currency: 'CAD' },
    ]

    const res = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: source.id, offsetAccountId: offset.id, defaultCurrency: 'CAD', transactions: parsed }),
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

    // Spot-check the Coffee transaction: source gets -50, offset gets +50
    const coffee = txs.find((tx: { description: string }) => tx.description === 'Coffee')
    expect(coffee.postings).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: source.id, amount: '-50.00', currency: 'CAD' }),
      expect.objectContaining({ accountId: offset.id, amount: '50.00', currency: 'CAD' }),
    ]))
  })
})
