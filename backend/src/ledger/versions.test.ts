import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { accounts, csvParsers, importRules, transactions, userSettings } from '../db/schema'
import { clearDatabase, createTestUser, request } from '../test-utils'

// Every change to a sync document moves its version, the root row's `updatedAt`
// (planning/epics/sync-unit.md). Each test backdates a document's version to 2000, makes
// one change through the app, and checks the version moved past it. A root-row update moves
// it through the schema's `$onUpdate`; a change to a transaction's postings alone moves it
// through the ledger service. Both are covered here, writer by writer.

const LONG_AGO = new Date('2000-01-01T00:00:00Z')

type Root = typeof transactions | typeof accounts | typeof csvParsers | typeof importRules

async function backdate(table: Root, id: string): Promise<void> {
  await db.update(table).set({ updatedAt: LONG_AGO }).where(eq(table.id, id))
}

async function versionOf(table: Root, id: string): Promise<Date> {
  const [row] = await db.select({ v: table.updatedAt }).from(table).where(eq(table.id, id))
  if (!row) throw new Error(`no row ${id}`)
  return row.v
}

async function expectMoved(table: Root, id: string): Promise<void> {
  expect((await versionOf(table, id)).getTime()).toBeGreaterThan(LONG_AGO.getTime())
}

const json = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' })

async function send(cookie: string, path: string, body?: unknown, method = 'POST') {
  return request(path, {
    method,
    headers: json(cookie),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function idOf(res: Response): Promise<string> {
  return ((await res.json()) as { id: string }).id
}

async function userId(cookie: string): Promise<string> {
  const res = await request('/api/auth/get-session', { headers: { Cookie: cookie } })
  return ((await res.json()) as { user: { id: string } }).user.id
}

let alice: string
let bob: string

beforeEach(async () => {
  await clearDatabase()
  alice = await createTestUser('alice@example.com')
  bob = await createTestUser('bob@example.com')
})

const account = async (cookie: string, path: string) =>
  idOf(await send(cookie, '/api/accounts', { path }))

async function transaction(cookie: string, from: string, to: string, amount = '5.00') {
  return idOf(
    await send(cookie, '/api/transactions', {
      date: '2026-01-01',
      description: 'Lunch',
      postings: [
        { accountId: from, amount: `-${amount}`, currency: 'CAD' },
        { accountId: to, amount, currency: 'CAD' },
      ],
    }),
  )
}

describe('a transaction', () => {
  let cash: string
  let food: string
  let id: string

  beforeEach(async () => {
    cash = await account(alice, 'assets:chequing')
    food = await account(alice, 'expenses:food')
    id = await transaction(alice, cash, food)
    await backdate(transactions, id)
  })

  it('is created with a version', async () => {
    const fresh = await transaction(alice, cash, food)
    await expectMoved(transactions, fresh)
  })

  it('moves when its description or date is edited', async () => {
    await send(alice, `/api/transactions/${id}`, { description: 'Dinner' }, 'PATCH')
    await expectMoved(transactions, id)
  })

  it('moves when its postings alone are replaced, and says so in the response', async () => {
    const res = await send(alice, `/api/transactions/${id}/postings`, {
      postings: [
        { accountId: cash, amount: '-7.00', currency: 'CAD' },
        { accountId: food, amount: '7.00', currency: 'CAD' },
      ],
    })
    expect(res.status).toBe(200)
    await expectMoved(transactions, id)
    const body = (await res.json()) as { updatedAt: string }
    expect(new Date(body.updatedAt).getTime()).toBe((await versionOf(transactions, id)).getTime())
  })

  it('moves when it is deleted, so the tombstone wins', async () => {
    await send(alice, `/api/transactions/${id}`, undefined, 'DELETE')
    await expectMoved(transactions, id)
  })

  it('moves when heal re-points its postings', async () => {
    const usd = await account(alice, 'assets:bank:usd')
    const coffee = await account(alice, 'expenses:coffee')
    const fee = await account(alice, 'expenses:banking')
    const czk = await account(alice, 'assets:bank:czk')
    const conversions = await account(alice, 'equity:conversions')
    await send(alice, '/api/user-settings', { defaultConversionAccountId: conversions }, 'PATCH')
    const malformed = await idOf(
      await send(alice, '/api/transactions', {
        date: '2026-05-31',
        postings: [
          { accountId: usd, amount: '-17.29', currency: 'USD' },
          { accountId: coffee, amount: '17.24', currency: 'USD' },
          { accountId: fee, amount: '0.05', currency: 'USD' },
          { accountId: coffee, amount: '-360.00', currency: 'CZK' },
          { accountId: czk, amount: '360.00', currency: 'CZK' },
        ],
      }),
    )
    await backdate(transactions, malformed)

    const res = await send(alice, `/api/transactions/${malformed}/heal-fx-spend`)
    expect(res.status).toBe(200)
    await expectMoved(transactions, malformed)
  })
})

describe('a Fish Pie transaction', () => {
  let groupId: string
  let aliceCash: string
  let bobId: string

  beforeEach(async () => {
    bobId = await userId(bob)
    groupId = await idOf(await send(alice, '/api/fish-pie/groups', { name: 'Flat' }))
    const invite = await idOf(
      await send(alice, `/api/fish-pie/groups/${groupId}/invites`, { email: 'bob@example.com' }),
    )
    await send(bob, `/api/fish-pie/invites/${invite}/accept`)
    aliceCash = await account(alice, 'assets:chequing')
  })

  async function memberTransactions(expenseId: string): Promise<string[]> {
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expenseId))
    return rows.map((r) => r.id)
  }

  async function expense(): Promise<string> {
    return idOf(
      await send(alice, `/api/fish-pie/groups/${groupId}/expenses`, {
        description: 'Dinner',
        amount: '40.00',
        currency: 'CAD',
        date: '2026-05-01',
        paymentAccountId: aliceCash,
      }),
    )
  }

  it("moves when an edit rebalances the payer's imported transaction", async () => {
    const imported = await send(alice, '/api/import/commit', {
      accountId: aliceCash,
      defaultCurrency: 'CAD',
      transactions: [
        { date: '2026-05-01', amount: '-40.00', currency: 'CAD', description: 'Dinner' },
      ],
      groupSplits: [{ rowIndex: 0, groupId }],
    })
    expect(imported.status).toBe(201)
    const [shared] = (await (
      await request(`/api/fish-pie/groups/${groupId}/expenses`, { headers: { Cookie: alice } })
    ).json()) as { id: string; transactionId: string }[]
    if (!shared) throw new Error('the import created no expense')
    await backdate(transactions, shared.transactionId)

    const res = await send(
      alice,
      `/api/fish-pie/groups/${groupId}/expenses/${shared.id}`,
      { amount: '50.00' },
      'PATCH',
    )
    expect(res.status).toBe(200)
    await expectMoved(transactions, shared.transactionId)
  })

  it('moves when an edit retires the member transactions', async () => {
    const expenseId = await expense()
    const before = await memberTransactions(expenseId)
    for (const id of before) await backdate(transactions, id)

    await send(
      alice,
      `/api/fish-pie/groups/${groupId}/expenses/${expenseId}`,
      { description: 'Late dinner' },
      'PATCH',
    )
    for (const id of before) await expectMoved(transactions, id)
  })

  it('moves when the expense is deleted, by either route', async () => {
    for (const path of [
      (id: string) => `/api/fish-pie/groups/${groupId}/expenses/${id}`,
      (id: string) => `/api/fish-pie/group-expenses/${id}`,
    ]) {
      const expenseId = await expense()
      const linked = await memberTransactions(expenseId)
      for (const id of linked) await backdate(transactions, id)

      const res = await send(alice, path(expenseId), undefined, 'DELETE')
      expect(res.status).toBe(204)
      for (const id of linked) await expectMoved(transactions, id)
    }
  })

  it('moves when a settlement is deleted', async () => {
    const bobCash = await account(bob, 'assets:chequing')
    const settlement = (await (
      await send(bob, `/api/fish-pie/groups/${groupId}/settlements`, {
        fromUserId: bobId,
        toUserId: await userId(alice),
        amount: '20.00',
        currency: 'CAD',
        date: '2026-05-02',
        payerAccountId: bobCash,
      })
    ).json()) as { id: string; payerTransactionId: string }
    await backdate(transactions, settlement.payerTransactionId)

    const res = await send(
      bob,
      `/api/fish-pie/groups/${groupId}/settlements/${settlement.id}`,
      undefined,
      'DELETE',
    )
    expect(res.status).toBe(204)
    await expectMoved(transactions, settlement.payerTransactionId)
  })

  it('moves when a group merge re-points its clearing leg, and only then', async () => {
    const food = await idOf(await send(alice, '/api/fish-pie/groups', { name: 'Food' }))
    const invite = await idOf(
      await send(alice, `/api/fish-pie/groups/${food}/invites`, { email: 'bob@example.com' }),
    )
    await send(bob, `/api/fish-pie/invites/${invite}/accept`)
    const expenseId = await expense()
    const [payerTx] = (
      await db
        .select({ id: transactions.id, userId: transactions.userId })
        .from(transactions)
        .where(eq(transactions.groupExpenseId, expenseId))
    ).filter((t) => t.userId !== bobId)
    if (!payerTx) throw new Error('no payer transaction')
    const untouched = await transaction(alice, aliceCash, await account(alice, 'expenses:misc'))
    await backdate(transactions, payerTx.id)
    await backdate(transactions, untouched)

    const res = await send(alice, '/api/fish-pie/groups/merge', {
      groupIds: [groupId, food],
      name: 'Household',
    })
    expect(res.status).toBe(201)
    await expectMoved(transactions, payerTx.id)
    expect(await versionOf(transactions, untouched)).toEqual(LONG_AGO)
  })
})

describe('an account', () => {
  it('moves when it is edited, renamed or deleted', async () => {
    const edited = await account(alice, 'assets:chequing')
    const renamed = await account(alice, 'assets:bank:savings')
    const deleted = await account(alice, 'assets:wallet')
    for (const id of [edited, renamed, deleted]) await backdate(accounts, id)

    await send(alice, `/api/accounts/${edited}`, { name: 'Everyday' }, 'PATCH')
    await send(alice, '/api/accounts/rename', { from: 'assets:bank', to: 'assets:credit-union' })
    await send(alice, `/api/accounts/${deleted}`, undefined, 'DELETE')

    for (const id of [edited, renamed, deleted]) await expectMoved(accounts, id)
  })
})

describe('a parser', () => {
  it('moves when it is edited or deleted', async () => {
    const create = () =>
      send(alice, '/api/parsers', {
        name: 'Bank',
        normalizedHeader: 'amount|date|description',
        columnMapping: { date: 'date', amount: 'amount', description: 'description' },
      })
    const edited = await idOf(await create())
    const deleted = await idOf(await create())
    for (const id of [edited, deleted]) await backdate(csvParsers, id)

    await send(alice, `/api/parsers/${edited}`, { name: 'Credit union' }, 'PATCH')
    await send(alice, `/api/parsers/${deleted}`, undefined, 'DELETE')

    for (const id of [edited, deleted]) await expectMoved(csvParsers, id)
  })
})

describe('a rule', () => {
  it('moves when it is edited, approved or deleted, without the route setting it', async () => {
    const food = await account(alice, 'expenses:food')
    const create = async () =>
      idOf(await send(alice, '/api/rules', { pattern: 'cafe', accountId: food }))
    const edited = await create()
    const deleted = await create()
    const [suggested] = await db
      .insert(importRules)
      .values({
        userId: await userId(alice),
        pattern: 'bakery',
        accountId: food,
        status: 'suggested',
      })
      .returning({ id: importRules.id })
    if (!suggested) throw new Error('no suggested rule')
    for (const id of [edited, deleted, suggested.id]) await backdate(importRules, id)

    await send(alice, `/api/rules/${edited}`, { pattern: 'coffee' }, 'PATCH')
    await send(alice, `/api/rules/${suggested.id}/approve`)
    await send(alice, `/api/rules/${deleted}`, undefined, 'DELETE')

    for (const id of [edited, deleted, suggested.id]) await expectMoved(importRules, id)
  })
})

describe('the settings', () => {
  async function settingsVersion(): Promise<Date> {
    const [row] = await db
      .select({ v: userSettings.updatedAt })
      .from(userSettings)
      .where(eq(userSettings.userId, await userId(alice)))
    if (!row) throw new Error('no settings row')
    return row.v
  }

  async function backdateSettings(): Promise<void> {
    await db
      .update(userSettings)
      .set({ updatedAt: LONG_AGO })
      .where(eq(userSettings.userId, await userId(alice)))
  }

  it('move when a setting is changed, through the upsert', async () => {
    await send(alice, '/api/user-settings', { preferredCurrency: 'EUR' }, 'PATCH')
    await backdateSettings()

    await send(alice, '/api/user-settings', { preferredCurrency: 'CAD' }, 'PATCH')
    expect((await settingsVersion()).getTime()).toBeGreaterThan(LONG_AGO.getTime())
  })

  it("move when an account's catch-up config is written into them", async () => {
    const cash = await account(alice, 'assets:chequing')
    await send(alice, '/api/user-settings', { preferredCurrency: 'EUR' }, 'PATCH')
    await backdateSettings()

    const res = await send(alice, `/api/coverage/config/${cash}`, { tracked: true }, 'PATCH')
    expect(res.status).toBe(200)
    expect((await settingsVersion()).getTime()).toBeGreaterThan(LONG_AGO.getTime())
  })
})
