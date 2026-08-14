import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { accounts, transactions, postings, importRules } from '../db/schema'
import { eq } from 'drizzle-orm'

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

// --- Fish Pie split targets --------------------------------------------------
//
// A rule points at exactly one target: an expense account, or a group (with an
// optional category). These cover both kinds through the same endpoints.

describe('rules — split targets', () => {
  let cookie: string
  let userId: string
  let groupId: string

  async function createGroup(c: string, name = 'Household'): Promise<string> {
    const res = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: c, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return (await res.json()).id
  }

  async function createCategory(c: string, gId: string, name: string) {
    const res = await app.request(`/api/fish-pie/groups/${gId}/categories`, {
      method: 'POST',
      headers: { Cookie: c, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return await res.json()
  }

  function postRule(c: string, body: Record<string, unknown>) {
    return app.request('/api/rules', {
      method: 'POST',
      headers: { Cookie: c, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function listRules(c: string) {
    return app.request('/api/rules', { headers: { Cookie: c } }).then((r) => r.json())
  }

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    const session = await (await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })).json()
    userId = session.user.id
    groupId = await createGroup(cookie)
  })

  it('creates a group rule and lists it with the group name', async () => {
    const res = await postRule(cookie, { pattern: 'BILLA', groupId })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.groupId).toBe(groupId)
    expect(created.accountId).toBeNull()

    const rules = await listRules(cookie)
    expect(rules).toBeArrayOfSize(1)
    expect(rules[0].groupName).toBe('Household')
    expect(rules[0].categoryName).toBeNull()
    // No account target, so no account display fields.
    expect(rules[0].accountPath).toBeNull()
  })

  it('creates a group rule with a category and lists both names', async () => {
    const category = await createCategory(cookie, groupId, 'Groceries')

    const res = await postRule(cookie, { pattern: 'BILLA', groupId, categoryId: category.id })
    expect(res.status).toBe(201)

    const rules = await listRules(cookie)
    expect(rules[0].groupName).toBe('Household')
    expect(rules[0].categoryName).toBe('Groceries')
  })

  it('lists account rules and group rules together, each with only its own fields', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')
    await postRule(cookie, { pattern: 'LOBLAWS', accountId: acct.id })
    await postRule(cookie, { pattern: 'BILLA', groupId })

    const rules = await listRules(cookie)
    expect(rules).toBeArrayOfSize(2)

    const loblaws = rules.find((r: { pattern: string }) => r.pattern === 'LOBLAWS')
    expect(loblaws.accountPath).toBe('expenses:food:groceries')
    expect(loblaws.groupName).toBeNull()

    const billa = rules.find((r: { pattern: string }) => r.pattern === 'BILLA')
    expect(billa.groupName).toBe('Household')
    expect(billa.accountPath).toBeNull()
  })

  it('rejects a rule with both targets set', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')
    const res = await postRule(cookie, { pattern: 'BILLA', accountId: acct.id, groupId })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('not both')
  })

  it('rejects a rule with neither target set', async () => {
    const res = await postRule(cookie, { pattern: 'BILLA' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('either accountId or groupId')
  })

  it('rejects a categoryId sent alongside an accountId', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')
    const category = await createCategory(cookie, groupId, 'Groceries')
    const res = await postRule(cookie, { pattern: 'BILLA', accountId: acct.id, categoryId: category.id })
    expect(res.status).toBe(400)
  })

  it('rejects a group the user is not a member of', async () => {
    const otherCookie = await createTestUser('other@example.com')
    const otherGroupId = await createGroup(otherCookie, 'Their House')

    const res = await postRule(cookie, { pattern: 'BILLA', groupId: otherGroupId })
    expect(res.status).toBe(403)
  })

  it('rejects an account belonging to another user', async () => {
    const otherCookie = await createTestUser('other@example.com')
    const otherSession = await (await app.request('/api/auth/get-session', { headers: { Cookie: otherCookie } })).json()
    const theirAccount = await createAccount(otherSession.user.id, 'expenses:theirs')

    const res = await postRule(cookie, { pattern: 'BILLA', accountId: theirAccount.id })
    expect(res.status).toBe(404)
  })

  it('rejects a category from a different group', async () => {
    const otherGroupId = await createGroup(cookie, 'Trip')
    const category = await createCategory(cookie, otherGroupId, 'Flights')

    const res = await postRule(cookie, { pattern: 'BILLA', groupId, categoryId: category.id })
    expect(res.status).toBe(404)
  })

  it('rejects an archived category', async () => {
    const category = await createCategory(cookie, groupId, 'Groceries')
    await app.request(`/api/fish-pie/groups/${groupId}/categories/${category.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })

    const res = await postRule(cookie, { pattern: 'BILLA', groupId, categoryId: category.id })
    expect(res.status).toBe(400)
  })

  it('patching an account rule to a group target clears the account', async () => {
    const acct = await createAccount(userId, 'expenses:food:groceries')
    const created = await (await postRule(cookie, { pattern: 'BILLA', accountId: acct.id })).json()

    const res = await app.request(`/api/rules/${created.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(updated.groupId).toBe(groupId)
    expect(updated.accountId).toBeNull()
  })

  it('patching a group rule to an account target clears the group and category', async () => {
    const category = await createCategory(cookie, groupId, 'Groceries')
    const created = await (await postRule(cookie, { pattern: 'BILLA', groupId, categoryId: category.id })).json()
    const acct = await createAccount(userId, 'expenses:food:groceries')

    const res = await app.request(`/api/rules/${created.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: acct.id }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(updated.accountId).toBe(acct.id)
    expect(updated.groupId).toBeNull()
    expect(updated.categoryId).toBeNull()
  })

  it('patching only the pattern leaves the target alone', async () => {
    const created = await (await postRule(cookie, { pattern: 'BILLA', groupId })).json()

    const res = await app.request(`/api/rules/${created.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'BILLA MARKT' }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(updated.pattern).toBe('BILLA MARKT')
    expect(updated.groupId).toBe(groupId)
  })

  // The route validates the one-target invariant and is what produces a readable 400.
  // These pin the database-level backstop, which is what catches a write that never
  // reaches the route — /api/rules/mine inserts directly, and so will later stories.
  describe('one-target CHECK constraint', () => {
    // Postgres names the violated constraint in the error, which is what we assert on —
    // a NOT NULL or FK failure would not mention it.
    async function expectOneTargetViolation(write: () => Promise<unknown>) {
      let message = ''
      try {
        await write()
      } catch (e) {
        message = (e as Error).message
      }
      expect(message).toContain('import_rules_one_target')
    }

    it('rejects a direct insert with both targets set', async () => {
      const acct = await createAccount(userId, 'expenses:food:groceries')
      await expectOneTargetViolation(() =>
        db.insert(importRules).values({ userId, pattern: 'BILLA', accountId: acct.id, groupId }),
      )
    })

    it('rejects a direct insert with no target set', async () => {
      await expectOneTargetViolation(() =>
        db.insert(importRules).values({ userId, pattern: 'BILLA' }),
      )
    })

    it('rejects a direct insert with a category but no group', async () => {
      const category = await createCategory(cookie, groupId, 'Groceries')
      await expectOneTargetViolation(() =>
        db.insert(importRules).values({ userId, pattern: 'BILLA', categoryId: category.id }),
      )
    })

    it('rejects an update that would leave a rule with both targets', async () => {
      const acct = await createAccount(userId, 'expenses:food:groceries')
      const [rule] = await db
        .insert(importRules)
        .values({ userId, pattern: 'BILLA', accountId: acct.id })
        .returning()

      await expectOneTargetViolation(() =>
        db.update(importRules).set({ groupId }).where(eq(importRules.id, rule.id)),
      )
    })

    it('accepts both legitimate target shapes', async () => {
      const acct = await createAccount(userId, 'expenses:food:groceries')
      const category = await createCategory(cookie, groupId, 'Groceries')

      await db.insert(importRules).values({ userId, pattern: 'LOBLAWS', accountId: acct.id })
      await db.insert(importRules).values({ userId, pattern: 'BILLA', groupId })
      await db.insert(importRules).values({ userId, pattern: 'HOFER', groupId, categoryId: category.id })

      const rules = await listRules(cookie)
      expect(rules).toBeArrayOfSize(3)
    })
  })

  it('an active split rule does not suggest an account on import preview', async () => {
    // Story 3 teaches preview to apply split rules. Until then an active one must be
    // inert rather than pre-filling a null account.
    await postRule(cookie, { pattern: 'Coffee', groupId })

    await app.request('/api/parsers', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Bank',
        normalizedHeader: 'amount|date|description',
        columnMapping: { date: 'date', amount: 'amount', description: 'description' },
      }),
    })

    const form = new FormData()
    form.append('file', new Blob(['Date,Amount,Description\n2026-02-01,-42.50,Coffee'], { type: 'text/csv' }), 'e.csv')
    form.append('defaultCurrency', 'CAD')

    const res = await app.request('/api/import/preview', { method: 'POST', headers: { Cookie: cookie }, body: form })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transactions[0].suggestedOffsetAccountId).toBeUndefined()
    expect(body.transactions[0].matchedRulePattern).toBeUndefined()
  })
})
