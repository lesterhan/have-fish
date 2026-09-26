import { beforeEach, describe, expect, it } from 'bun:test'
import { eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { accounts, postings, transactions } from '../db/schema'
import { clearDatabase, createTestUser, request } from '../test-utils'

// Every writer (a request, an import row, a Fish Pie expense or settlement) goes through
// the ledger write service, so every one gets the same validation. These tests pin down
// what that means for the writers that used to build legs and insert them unchecked: a
// transaction that doesn't validate is refused, with a code the client can read, and
// nothing from the refused request is written.

let alice: string
let bob: string
let aliceId: string
let bobId: string

const json = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' })

async function send(cookie: string, path: string, body: unknown, method = 'POST') {
  return request(path, { method, headers: json(cookie), body: JSON.stringify(body) })
}

async function userId(cookie: string): Promise<string> {
  const res = await request('/api/auth/get-session', { headers: { Cookie: cookie } })
  return ((await res.json()) as { user: { id: string } }).user.id
}

async function account(cookie: string, path: string): Promise<string> {
  return ((await (await send(cookie, '/api/accounts', { path })).json()) as { id: string }).id
}

async function transactionCount(): Promise<number> {
  return (await db.select({ id: transactions.id }).from(transactions)).length
}

beforeEach(async () => {
  await clearDatabase()
  alice = await createTestUser('alice@example.com')
  bob = await createTestUser('bob@example.com')
  aliceId = await userId(alice)
  bobId = await userId(bob)
})

describe('import commit through the ledger service', () => {
  it('refuses an unsupported currency, naming the row, and writes no row at all', async () => {
    const cash = await account(alice, 'assets:chequing')
    const food = await account(alice, 'expenses:food')

    const res = await send(alice, '/api/import/commit', {
      accountId: cash,
      defaultCurrency: 'CAD',
      transactions: [
        { date: '2026-02-01', amount: '-5.00', currency: 'CAD', offsetAccountId: food },
        { date: '2026-02-02', amount: '-5.00', currency: 'ZZZ', offsetAccountId: food },
      ],
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'UNSUPPORTED_CURRENCY',
      detail: { currency: 'ZZZ', index: 1 },
    })
    // Row 0 was valid and was written first; the refusal of row 1 rolled it back.
    expect(await transactionCount()).toBe(0)
  })

  it('refuses a transfer whose fee is in a third currency, which cannot balance', async () => {
    // The transfer builder bridges the source currency through the conversion account on
    // the assumption that the fee is in that currency. A fee in any other currency leaves
    // the source currency short by the fee, and this used to be written anyway.
    const res = await send(alice, '/api/import/commit', {
      defaultCurrency: 'CAD',
      transactions: [
        {
          isTransfer: true,
          date: '2026-03-01',
          sourceAmount: '-200.00',
          sourceCurrency: 'CAD',
          targetAmount: '107.90',
          targetCurrency: 'GBP',
          feeAmount: '1.00',
          feeCurrency: 'USD',
          sourceAccountId: await account(alice, 'assets:wise:cad'),
          targetAccountId: await account(alice, 'assets:wise:gbp'),
          conversionAccountId: await account(alice, 'equity:conversions'),
          feeAccountId: await account(alice, 'expenses:fees'),
        },
      ],
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'POSTINGS_DO_NOT_BALANCE',
      detail: { currency: 'CAD', index: 0 },
    })
    expect(await transactionCount()).toBe(0)
  })
})

describe('Fish Pie through the ledger service', () => {
  let groupId: string
  let aliceCash: string
  let bobCash: string

  beforeEach(async () => {
    groupId = (
      (await (await send(alice, '/api/fish-pie/groups', { name: 'Flat' })).json()) as {
        id: string
      }
    ).id
    const invite = (await (
      await send(alice, `/api/fish-pie/groups/${groupId}/invites`, { email: 'bob@example.com' })
    ).json()) as { id: string }
    await request(`/api/fish-pie/invites/${invite.id}/accept`, {
      method: 'POST',
      headers: { Cookie: bob },
    })
    aliceCash = await account(alice, 'assets:chequing')
    bobCash = await account(bob, 'assets:chequing')
  })

  it('refuses an expense in an unsupported currency and writes nothing', async () => {
    const res = await send(alice, `/api/fish-pie/groups/${groupId}/expenses`, {
      description: 'Dinner',
      amount: '10.00',
      currency: 'ZZZ',
      date: '2026-04-01',
      paymentAccountId: aliceCash,
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'UNSUPPORTED_CURRENCY', detail: { currency: 'ZZZ' } })
    expect(await transactionCount()).toBe(0)
  })

  it('refuses a settlement in an unsupported currency and writes nothing', async () => {
    const res = await send(bob, `/api/fish-pie/groups/${groupId}/settlements`, {
      fromUserId: bobId,
      toUserId: aliceId,
      amount: '5.00',
      currency: 'ZZZ',
      date: '2026-04-02',
      payerAccountId: bobCash,
    })

    expect(res.status).toBe(400)
    expect(await transactionCount()).toBe(0)
  })

  it("keeps every leg of an imported expense's transaction in its owner's own accounts", async () => {
    // Alice imports a shared dinner, so its transaction is hers. Reassigning the payer to
    // Bob would rebalance that transaction with Bob's expense account; the ledger service
    // refuses a leg in an account its owner doesn't hold, and the legs stay as they were.
    const imported = await send(alice, '/api/import/commit', {
      accountId: aliceCash,
      defaultCurrency: 'CAD',
      transactions: [
        { date: '2026-05-01', amount: '-40.00', currency: 'CAD', description: 'Dinner' },
      ],
      groupSplits: [{ rowIndex: 0, groupId }],
    })
    expect(imported.status).toBe(201)
    const [expense] = (await (
      await request(`/api/fish-pie/groups/${groupId}/expenses`, { headers: { Cookie: alice } })
    ).json()) as { id: string; transactionId: string }[]
    if (!expense) throw new Error('the import created no expense')

    const legOwners = async () =>
      (
        await db
          .select({
            owner: accounts.userId,
            amount: postings.amount,
            deletedAt: postings.deletedAt,
          })
          .from(postings)
          .innerJoin(accounts, eq(accounts.id, postings.accountId))
          .where(eq(postings.transactionId, expense.transactionId))
      )
        .filter((l) => l.deletedAt === null)
        .map((l) => `${l.owner === aliceId ? 'alice' : 'bob'} ${l.amount}`)
        .sort()
    const before = await legOwners()
    expect(before.every((l) => l.startsWith('alice'))).toBe(true)

    const res = await send(
      alice,
      `/api/fish-pie/groups/${groupId}/expenses/${expense.id}`,
      { paidByUserId: bobId },
      'PATCH',
    )

    expect(res.status).toBe(404)
    expect(await legOwners()).toEqual(before)
  })
})

describe('a refused write inside a unit of work', () => {
  it('leaves no clearing account, expense or member transaction behind', async () => {
    const groupId = (
      (await (await send(alice, '/api/fish-pie/groups', { name: 'Solo' })).json()) as {
        id: string
      }
    ).id
    const cash = await account(alice, 'assets:chequing')
    const before = (await db.select().from(accounts).where(isNull(accounts.deletedAt))).length

    const res = await send(alice, `/api/fish-pie/groups/${groupId}/expenses`, {
      description: 'Dinner',
      amount: '10.00',
      currency: 'ZZZ',
      date: '2026-04-01',
      paymentAccountId: cash,
    })

    expect(res.status).toBe(400)
    // The clearing account and the uncategorized fallback are created inside the same
    // database transaction as the refused write, so they roll back with it.
    expect((await db.select().from(accounts).where(isNull(accounts.deletedAt))).length).toBe(before)
    const expenses = (await (
      await request(`/api/fish-pie/groups/${groupId}/expenses`, { headers: { Cookie: alice } })
    ).json()) as unknown[]
    expect(expenses).toEqual([])
  })
})

// The amounts are checked in cents, rounded as the column rounds them (#279), so what passes
// is what balances once stored, and what isn't a number is refused before the database sees it.
describe('amounts, checked as they will be stored', () => {
  it('refuses an amount that is not a number, rather than storing NaN or failing at insert', async () => {
    const cash = await account(alice, 'assets:chequing')
    const food = await account(alice, 'expenses:food')

    for (const [amount, other] of [
      ['NaN', 'NaN'],
      ['abc', '-5.00'],
      ['', '0'],
      ['99999999999', '-99999999999'],
    ]) {
      const res = await send(alice, '/api/transactions', {
        date: '2026-01-01',
        postings: [
          { accountId: cash, amount, currency: 'CAD' },
          { accountId: food, amount: other, currency: 'CAD' },
        ],
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'AMOUNT_INVALID', detail: { amount } })
    }
    expect(await transactionCount()).toBe(0)
  })

  it('refuses legs that would be stored unbalanced, though their floats were close', async () => {
    const cash = await account(alice, 'assets:chequing')
    const food = await account(alice, 'expenses:food')

    const res = await send(alice, '/api/transactions', {
      date: '2026-01-01',
      postings: [
        { accountId: cash, amount: '0.005', currency: 'CAD' },
        { accountId: food, amount: '-0.004', currency: 'CAD' },
      ],
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'POSTINGS_DO_NOT_BALANCE',
      detail: { currency: 'CAD', sum: 0.01 },
    })
    expect(await transactionCount()).toBe(0)
  })

  it('names the entry with the bad amount in a batch, and writes none of the batch', async () => {
    const cash = await account(alice, 'assets:chequing')
    const food = await account(alice, 'expenses:food')
    const entry = (amount: string) => ({
      date: '2026-01-01',
      postings: [
        { accountId: cash, amount, currency: 'CAD' },
        { accountId: food, amount: '-5.00', currency: 'CAD' },
      ],
    })

    const res = await send(alice, '/api/transactions/bulk', {
      transactions: [entry('5.00'), entry('5.OO')],
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'AMOUNT_INVALID',
      detail: { amount: '5.OO', index: 1 },
    })
    expect(await transactionCount()).toBe(0)
  })

  it('stores an amount the way it was checked', async () => {
    const cash = await account(alice, 'assets:chequing')
    const food = await account(alice, 'expenses:food')

    const res = await send(alice, '/api/transactions', {
      date: '2026-01-01',
      postings: [
        { accountId: cash, amount: 0.1 + 0.2, currency: 'CAD' },
        { accountId: food, amount: '-0.3', currency: 'CAD' },
      ],
    })
    expect(res.status).toBe(201)
    const id = ((await res.json()) as { id: string }).id
    const stored = await db.select().from(postings).where(eq(postings.transactionId, id))
    expect(stored.map((p) => p.amount).sort()).toEqual(['-0.30', '0.30'])
  })
})
