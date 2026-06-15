import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { accounts, transactions, postings, importRules } from '../db/schema'

async function createAccount(userId: string, path: string) {
  const [acct] = await db.insert(accounts).values({ userId, path }).returning()
  return acct
}

async function seedTransaction(
  userId: string,
  description: string,
  sourceAccountId: string,
  expenseAccountId: string,
) {
  const [tx] = await db.insert(transactions).values({ userId, date: new Date(), description }).returning()
  await db.insert(postings).values([
    { transactionId: tx.id, accountId: sourceAccountId, amount: '-10.00', currency: 'CAD' },
    { transactionId: tx.id, accountId: expenseAccountId, amount: '10.00', currency: 'CAD' },
  ])
  return tx
}

describe('rules', () => {
  let cookie: string
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    // Extract userId from session
    const sessionRes = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
    const session = await sessionRes.json()
    userId = session.user.id
  })

  it('mines suggestions from transaction history', async () => {
    const chequing = await createAccount(userId, 'assets:chequing')
    const groceries = await createAccount(userId, 'expenses:food:groceries')

    await seedTransaction(userId, 'LOBLAWS #042', chequing.id, groceries.id)
    await seedTransaction(userId, 'LOBLAWS #042', chequing.id, groceries.id)
    await seedTransaction(userId, 'LOBLAWS #042', chequing.id, groceries.id)

    const mineRes = await app.request('/api/rules/mine', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(mineRes.status).toBe(200)
    const { created } = await mineRes.json()
    expect(created).toBe(1)

    const listRes = await app.request('/api/rules', { headers: { Cookie: cookie } })
    const rules = await listRes.json()
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].pattern).toBe('LOBLAWS #042')
    expect(rules[0].status).toBe('suggested')
    expect(rules[0].matchCount).toBe(3)
  })

  it('denying a suggestion hides it without re-mining it later', async () => {
    const chequing = await createAccount(userId, 'assets:chequing')
    const groceries = await createAccount(userId, 'expenses:food:groceries')

    await seedTransaction(userId, 'LOBLAWS #042', chequing.id, groceries.id)
    await seedTransaction(userId, 'LOBLAWS #042', chequing.id, groceries.id)
    await seedTransaction(userId, 'LOBLAWS #042', chequing.id, groceries.id)

    // First mine produces the suggestion.
    await app.request('/api/rules/mine', { method: 'POST', headers: { Cookie: cookie } })
    let rules = await (await app.request('/api/rules', { headers: { Cookie: cookie } })).json()
    expect(rules).toBeArrayOfSize(1)
    const ruleId = rules[0].id

    // Deny it.
    const denyRes = await app.request(`/api/rules/${ruleId}/deny`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(denyRes.status).toBe(200)
    const denied = await denyRes.json()
    expect(denied.status).toBe('denied')

    // Mining again must NOT re-create the suggestion — the denied pattern stays suppressed.
    const mineRes = await app.request('/api/rules/mine', { method: 'POST', headers: { Cookie: cookie } })
    expect((await mineRes.json()).created).toBe(0)

    rules = await (await app.request('/api/rules', { headers: { Cookie: cookie } })).json()
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].status).toBe('denied')
  })

  it('reviving a denied rule returns it to the suggestions list', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')
    const [rule] = await db
      .insert(importRules)
      .values({ userId, pattern: 'LOBLAWS', accountId: acct.id, status: 'denied', matchCount: 5 })
      .returning()

    const reviveRes = await app.request(`/api/rules/${rule.id}/revive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(reviveRes.status).toBe(200)
    expect((await reviveRes.json()).status).toBe('suggested')

    const rules = await (await app.request('/api/rules', { headers: { Cookie: cookie } })).json()
    expect(rules[0].status).toBe('suggested')
  })

  it('deny rejects a rule that is not a suggestion', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')
    const [active] = await db
      .insert(importRules)
      .values({ userId, pattern: 'LOBLAWS', accountId: acct.id, status: 'active' })
      .returning()

    const res = await app.request(`/api/rules/${active.id}/deny`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('revive rejects a rule that is not denied', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')
    const [suggested] = await db
      .insert(importRules)
      .values({ userId, pattern: 'LOBLAWS', accountId: acct.id, status: 'suggested', matchCount: 3 })
      .returning()

    const res = await app.request(`/api/rules/${suggested.id}/revive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('creates a rule and fetches it', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')

    const createRes = await app.request('/api/rules', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'LOBLAWS', accountId: acct.id }),
    })
    expect(createRes.status).toBe(201)

    const listRes = await app.request('/api/rules', { headers: { Cookie: cookie } })
    expect(listRes.status).toBe(200)
    const rules = await listRes.json()
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].pattern).toBe('LOBLAWS')
    expect(rules[0].status).toBe('active')
    expect(rules[0].accountPath).toBe('expenses:food:groceries')
  })
})
