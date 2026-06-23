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

// Seeds a transaction with an arbitrary set of posting legs — used to model Fish Pie
// and multi-currency conversions, which have more than two postings.
async function seedMultiPostingTransaction(
  userId: string,
  description: string,
  legs: { accountId: string; amount: string; currency: string }[],
) {
  const [tx] = await db.insert(transactions).values({ userId, date: new Date(), description }).returning()
  await db.insert(postings).values(legs.map((l) => ({ transactionId: tx.id, ...l })))
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
    // Trailing store number stripped so the rule generalizes across LOBLAWS locations.
    expect(rules[0].pattern).toBe('LOBLAWS')
    expect(rules[0].status).toBe('suggested')
    expect(rules[0].matchCount).toBe(3)
  })

  it('mines a rule from Fish Pie transactions (3+ postings, one expense leg)', async () => {
    const wiseEur = await createAccount(userId, 'assets:wise:eur')
    const groceries = await createAccount(userId, 'expenses:food:groceries')
    const groupClearing = await createAccount(userId, 'assets:receivable:trip')

    // Two Fish Pie expenses: source leg + group (others' share) leg + expense (payer share) leg.
    for (let i = 0; i < 2; i++) {
      await seedMultiPostingTransaction(userId, 'CARREFOUR', [
        { accountId: wiseEur.id, amount: '-30.00', currency: 'EUR' },
        { accountId: groupClearing.id, amount: '20.00', currency: 'EUR' },
        { accountId: groceries.id, amount: '10.00', currency: 'EUR' },
      ])
    }

    const mineRes = await app.request('/api/rules/mine', { method: 'POST', headers: { Cookie: cookie } })
    expect(mineRes.status).toBe(200)
    expect((await mineRes.json()).created).toBe(1)

    const rules = await (await app.request('/api/rules', { headers: { Cookie: cookie } })).json()
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].pattern).toBe('CARREFOUR')
    expect(rules[0].accountPath).toBe('expenses:food:groceries')
    expect(rules[0].matchCount).toBe(2)
  })

  it('mines a rule from multi-currency conversion transactions (5 postings)', async () => {
    const wiseCad = await createAccount(userId, 'assets:wise:cad')
    const conversion = await createAccount(userId, 'equity:conversion')
    const dining = await createAccount(userId, 'expenses:food:dining')

    // Cross-currency expense: source + two conversion legs + expense leg.
    for (let i = 0; i < 2; i++) {
      await seedMultiPostingTransaction(userId, 'RESTAURANT TOKYO', [
        { accountId: wiseCad.id, amount: '-15.00', currency: 'CAD' },
        { accountId: conversion.id, amount: '15.00', currency: 'CAD' },
        { accountId: conversion.id, amount: '-1500.00', currency: 'JPY' },
        { accountId: dining.id, amount: '1500.00', currency: 'JPY' },
      ])
    }

    const mineRes = await app.request('/api/rules/mine', { method: 'POST', headers: { Cookie: cookie } })
    expect((await mineRes.json()).created).toBe(1)

    const rules = await (await app.request('/api/rules', { headers: { Cookie: cookie } })).json()
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].accountPath).toBe('expenses:food:dining')
    expect(rules[0].matchCount).toBe(2)
  })

  it('groups near-duplicate descriptions (different store numbers) into one rule', async () => {
    const chequing = await createAccount(userId, 'assets:chequing')
    const groceries = await createAccount(userId, 'expenses:food:groceries')

    // Same merchant, different terminal numbers — should normalize to "LOBLAWS" and count 3.
    await seedTransaction(userId, 'LOBLAWS #042', chequing.id, groceries.id)
    await seedTransaction(userId, 'LOBLAWS #119', chequing.id, groceries.id)
    await seedTransaction(userId, 'LOBLAWS #007', chequing.id, groceries.id)

    const mineRes = await app.request('/api/rules/mine', { method: 'POST', headers: { Cookie: cookie } })
    expect((await mineRes.json()).created).toBe(1)

    const rules = await (await app.request('/api/rules', { headers: { Cookie: cookie } })).json()
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].pattern).toBe('LOBLAWS')
    expect(rules[0].matchCount).toBe(3)
  })

  it('suggests on two matches (first-import floor)', async () => {
    const chequing = await createAccount(userId, 'assets:chequing')
    const transit = await createAccount(userId, 'expenses:transit')

    await seedTransaction(userId, 'TTC FARE', chequing.id, transit.id)
    await seedTransaction(userId, 'TTC FARE', chequing.id, transit.id)

    const mineRes = await app.request('/api/rules/mine', { method: 'POST', headers: { Cookie: cookie } })
    expect((await mineRes.json()).created).toBe(1)
  })

  it('does not suggest from a single occurrence', async () => {
    const chequing = await createAccount(userId, 'assets:chequing')
    const groceries = await createAccount(userId, 'expenses:food:groceries')

    await seedTransaction(userId, 'ONE OFF SHOP', chequing.id, groceries.id)

    const mineRes = await app.request('/api/rules/mine', { method: 'POST', headers: { Cookie: cookie } })
    expect((await mineRes.json()).created).toBe(0)
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
