import { describe, it, expect, beforeEach } from 'bun:test'
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

async function setConversionAccount(cookie: string, accountId: string) {
  return app.request('/api/user-settings', {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultConversionAccountId: accountId }),
  })
}

// Seeds the canonical malformed cross-currency spend (coffee 360 CZK funded from USD with
// the expense account reused as the FX bridge + a phantom CZK holding). It balances per
// currency, so it commits through the normal transactions endpoint.
async function seedMalformed(cookie: string, accts: Record<string, { id: string }>) {
  const res = await app.request('/api/transactions', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: '2026-05-31',
      description: 'You Are My Cup Of',
      postings: [
        { accountId: accts.usd.id,    amount: '-17.29',  currency: 'USD' },
        { accountId: accts.coffee.id, amount: '17.24',   currency: 'USD' },
        { accountId: accts.fee.id,    amount: '0.05',    currency: 'USD' },
        { accountId: accts.coffee.id, amount: '-360.00', currency: 'CZK' },
        { accountId: accts.czk.id,    amount: '360.00',  currency: 'CZK' },
      ],
    }),
  })
  return res.json()
}

describe('cross-currency spend healing', () => {
  let cookie: string
  let accts: Record<string, { id: string; path: string }>

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    accts = {
      usd:    await createAccount(cookie, 'assets:bank:savings:usd'),
      coffee: await createAccount(cookie, 'expenses:food:coffee'),
      fee:    await createAccount(cookie, 'expenses:banking'),
      czk:    await createAccount(cookie, 'assets:bank:savings:czk'),
      equity: await createAccount(cookie, 'equity:conversions'),
    }
  })

  it('lists the malformed transaction with a before/after preview', async () => {
    await setConversionAccount(cookie, accts.equity.id)
    await seedMalformed(cookie, accts)

    const res = await app.request('/api/transactions/malformed-fx-spend', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.conversionAccountConfigured).toBe(true)
    expect(body.candidates).toBeArrayOfSize(1)

    const cand = body.candidates[0]
    expect(cand.canHeal).toBe(true)
    expect(cand.before).toBeArrayOfSize(5)

    // After: coffee is a single +360 CZK leg; equity:conversions bridges both sides.
    const coffeeAfter = cand.after.filter((p: { accountId: string }) => p.accountId === accts.coffee.id)
    expect(coffeeAfter).toBeArrayOfSize(1)
    expect(coffeeAfter[0]).toEqual(expect.objectContaining({ amount: '360.00', currency: 'CZK' }))
    const equityAfter = cand.after.filter((p: { accountId: string }) => p.accountId === accts.equity.id)
    expect(equityAfter).toBeArrayOfSize(2)
  })

  it('heals the transaction into the correct shape and is idempotent', async () => {
    await setConversionAccount(cookie, accts.equity.id)
    const tx = await seedMalformed(cookie, accts)

    const healRes = await app.request(`/api/transactions/${tx.id}/heal-fx-spend`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(healRes.status).toBe(200)

    // Verify persisted shape via the transactions list
    const txRes = await app.request('/api/transactions', { headers: { Cookie: cookie } })
    const persisted = (await txRes.json()).find((t: { id: string }) => t.id === tx.id)
    const ps = persisted.postings

    // Single coffee spend leg
    const coffee = ps.filter((p: { accountId: string }) => p.accountId === accts.coffee.id)
    expect(coffee).toBeArrayOfSize(1)
    expect(coffee[0]).toEqual(expect.objectContaining({ amount: '360.00', currency: 'CZK' }))

    // No phantom CZK holding on the savings account
    expect(ps.some((p: { accountId: string }) => p.accountId === accts.czk.id)).toBe(false)

    // Equity bridges both currencies
    const equity = ps.filter((p: { accountId: string }) => p.accountId === accts.equity.id)
    expect(equity).toBeArrayOfSize(2)

    // Still balances per currency
    const usdSum = ps.filter((p: { currency: string }) => p.currency === 'USD')
      .reduce((a: number, p: { amount: string }) => a + parseFloat(p.amount), 0)
    const czkSum = ps.filter((p: { currency: string }) => p.currency === 'CZK')
      .reduce((a: number, p: { amount: string }) => a + parseFloat(p.amount), 0)
    expect(Math.abs(usdSum)).toBeLessThan(0.001)
    expect(Math.abs(czkSum)).toBeLessThan(0.001)

    // No longer listed as malformed
    const listRes = await app.request('/api/transactions/malformed-fx-spend', { headers: { Cookie: cookie } })
    expect((await listRes.json()).candidates).toBeArrayOfSize(0)

    // Healing again is rejected (not malformed anymore)
    const again = await app.request(`/api/transactions/${tx.id}/heal-fx-spend`, {
      method: 'POST', headers: { Cookie: cookie },
    })
    expect(again.status).toBe(409)
  })

  it('does not flag a healthy plain transaction', async () => {
    await setConversionAccount(cookie, accts.equity.id)
    await app.request('/api/transactions', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-05-31', description: 'Groceries',
        postings: [
          { accountId: accts.usd.id, amount: '-45.20', currency: 'USD' },
          { accountId: accts.coffee.id, amount: '45.20', currency: 'USD' },
        ],
      }),
    })
    const res = await app.request('/api/transactions/malformed-fx-spend', { headers: { Cookie: cookie } })
    expect((await res.json()).candidates).toBeArrayOfSize(0)
  })

  it('reports canHeal=false and rejects healing when no conversion account is configured', async () => {
    // Sign-up seeds a conversion account by default; clear it to exercise the unconfigured path.
    await app.request('/api/user-settings', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultConversionAccountId: null }),
    })
    const tx = await seedMalformed(cookie, accts)

    const listRes = await app.request('/api/transactions/malformed-fx-spend', { headers: { Cookie: cookie } })
    const body = await listRes.json()
    expect(body.conversionAccountConfigured).toBe(false)
    expect(body.candidates).toBeArrayOfSize(1)
    expect(body.candidates[0].canHeal).toBe(false)

    const healRes = await app.request(`/api/transactions/${tx.id}/heal-fx-spend`, {
      method: 'POST', headers: { Cookie: cookie },
    })
    expect(healRes.status).toBe(400)
    expect((await healRes.json()).error).toMatch(/conversion account/i)
  })

  it('surfaces malformed spends in the per-account attention indicators', async () => {
    await setConversionAccount(cookie, accts.equity.id)
    const tx = await seedMalformed(cookie, accts)

    // Summary attaches the txn to the balance accounts it touches (USD + CZK savings).
    const summaryRes = await app.request('/api/accounts/action-required-summary', { headers: { Cookie: cookie } })
    const summary = await summaryRes.json()
    const usdEntry = summary.find((e: { accountId: string }) => e.accountId === accts.usd.id)
    const czkEntry = summary.find((e: { accountId: string }) => e.accountId === accts.czk.id)
    expect(usdEntry?.count).toBe(1)
    expect(czkEntry?.count).toBe(1)
    // Not attached to the expense/equity accounts.
    expect(summary.find((e: { accountId: string }) => e.accountId === accts.coffee.id)).toBeUndefined()

    // Per-account endpoint flags which ids are malformed (so the row can offer Repair).
    const perAcct = await app.request(`/api/accounts/${accts.usd.id}/action-required`, { headers: { Cookie: cookie } })
    const body = await perAcct.json()
    expect(body.transactionIds).toContain(tx.id)
    expect(body.malformedTransactionIds).toEqual([tx.id])

    // After healing, the account is clear again.
    await app.request(`/api/transactions/${tx.id}/heal-fx-spend`, { method: 'POST', headers: { Cookie: cookie } })
    const after = await (await app.request('/api/accounts/action-required-summary', { headers: { Cookie: cookie } })).json()
    expect(after.find((e: { accountId: string }) => e.accountId === accts.usd.id)).toBeUndefined()
  })

  it("does not heal another user's transaction", async () => {
    await setConversionAccount(cookie, accts.equity.id)
    const tx = await seedMalformed(cookie, accts)

    const otherCookie = await createTestUser('other@example.com')
    const res = await app.request(`/api/transactions/${tx.id}/heal-fx-spend`, {
      method: 'POST', headers: { Cookie: otherCookie },
    })
    expect(res.status).toBe(404)
  })
})
