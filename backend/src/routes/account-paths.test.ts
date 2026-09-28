// Account paths ignore case (#480): through every door an account comes in by, and in every
// read that asks "at or under this path". The rule itself is `pathTakenBy` in
// `accounts/paths.ts`, tested there without a database.

import { beforeEach, describe, expect, it } from 'bun:test'
import { and, eq, isNull } from 'drizzle-orm'
import { db, dialect } from '../db'
import { accounts } from '../db/schema'
import { ensureUncategorizedAccount } from '../fish-pie-accounts-service'
import { accountAt, clearDatabase, createTestUser, request } from '../test-utils'

let cookie: string
let userId: string

beforeEach(async () => {
  await clearDatabase()
  cookie = await createTestUser()
  const session = await request('/api/auth/get-session', { headers: { Cookie: cookie } })
  userId = ((await session.json()) as { user: { id: string } }).user.id
})

const json = (c: string) => ({ Cookie: c, 'Content-Type': 'application/json' })

async function create(path: string, as = cookie) {
  return request('/api/accounts', {
    method: 'POST',
    headers: json(as),
    body: JSON.stringify({ path }),
  })
}

async function created(path: string): Promise<string> {
  const res = await create(path)
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function rename(from: string, to: string) {
  return request('/api/accounts/rename', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({ from, to }),
  })
}

async function activeRows() {
  return db
    .select({ path: accounts.path, pathKey: accounts.pathKey })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
}

describe('creating an account', () => {
  it('keeps the spelling it was typed with, and stores the key beside it', async () => {
    await created('Assets:Wise')

    const rows = await activeRows()
    expect(rows).toContainEqual({ path: 'Assets:Wise', pathKey: 'assets:wise' })
  })

  it('refuses the same path twice', async () => {
    await created('assets:wise')

    const res = await create('assets:wise')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'ACCOUNT_PATH_TAKEN',
      detail: { path: 'assets:wise' },
    })
  })

  it('refuses a path that differs only in case, naming the spelling already there', async () => {
    await created('assets:wise')

    const res = await create('Assets:WISE')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'ACCOUNT_PATH_TAKEN',
      detail: { path: 'assets:wise' },
    })
  })

  it('refuses a child that spells its parent differently', async () => {
    await created('assets:wise')

    const res = await create('assets:Wise:eur')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'ACCOUNT_PATH_TAKEN',
      detail: { path: 'assets:wise' },
    })
  })

  it("allows a row at a grouping node, and another user's identical path", async () => {
    await created('assets:wise:eur')
    await created('assets:wise')

    const other = await createTestUser('other@example.com')
    expect((await create('Assets:Wise', other)).status).toBe(201)
  })

  it('allows the path again once the account holding it is deleted', async () => {
    const id = await created('assets:wise')
    const del = await request(`/api/accounts/${id}`, { method: 'DELETE', headers: json(cookie) })
    expect(del.status).toBe(204)

    expect((await create('Assets:Wise')).status).toBe(201)
  })

  it('gives the accounts sign-up makes their keys', async () => {
    expect(await activeRows()).toEqual(
      expect.arrayContaining([
        { path: 'expenses:uncategorized', pathKey: 'expenses:uncategorized' },
        { path: 'equity:conversions', pathKey: 'equity:conversions' },
        { path: 'equity:adjustments', pathKey: 'equity:adjustments' },
      ]),
    )
  })

  it('finds the account Fish Pie wants in whatever case the user typed it', async () => {
    const mine = await created('Uncategorized')

    expect(await ensureUncategorizedAccount(userId)).toBe(mine)
    expect((await activeRows()).filter((r) => r.pathKey === 'uncategorized')).toHaveLength(1)
  })
})

describe('renaming an account', () => {
  it('changes only its case, and the key stays the same', async () => {
    await created('assets:wise')
    await created('assets:wise:eur')

    const res = await rename('assets:wise', 'assets:Wise')

    expect(res.status).toBe(200)
    expect(await activeRows()).toEqual(
      expect.arrayContaining([
        { path: 'assets:Wise', pathKey: 'assets:wise' },
        { path: 'assets:Wise:eur', pathKey: 'assets:wise:eur' },
      ]),
    )
  })

  it('writes the new key with the new path', async () => {
    await created('assets:wise')

    expect((await rename('assets:wise', 'Assets:Revolut')).status).toBe(200)

    expect(await activeRows()).toContainEqual({ path: 'Assets:Revolut', pathKey: 'assets:revolut' })
  })

  it('refuses a move onto a path that exists in another case', async () => {
    await created('assets:wise')
    await created('assets:bank')

    const res = await rename('assets:bank', 'assets:WISE')

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'RENAME_TARGET_EXISTS',
      detail: { path: 'assets:wise' },
    })
  })
})

describe('the index behind the rule', () => {
  it('refuses a direct insert that goes around the service', async () => {
    await created('assets:wise')

    let cause = ''
    try {
      await db.insert(accounts).values({ userId, path: 'Assets:Wise', pathKey: 'assets:wise' })
    } catch (e) {
      cause = ((e as Error).cause as Error | undefined)?.message ?? ''
    }

    // Postgres names the index; SQLite names the columns it covers.
    expect(cause).toContain(
      dialect === 'pg'
        ? 'accounts_user_path_key_idx'
        : 'UNIQUE constraint failed: accounts.user_id, accounts.path_key',
    )
  })

  it('does not count a deleted account', async () => {
    await db
      .insert(accounts)
      .values({ userId, path: 'assets:wise', pathKey: 'assets:wise', deletedAt: new Date() })

    await db.insert(accounts).values({ userId, path: 'assets:wise', pathKey: 'assets:wise' })

    expect((await activeRows()).filter((r) => r.pathKey === 'assets:wise')).toHaveLength(1)
  })
})

describe('reading at or under a path', () => {
  async function spend(accountId: string, description: string) {
    const offset = (await accountAt(cookie, 'equity:adjustments')).id
    const res = await request('/api/transactions', {
      method: 'POST',
      headers: json(cookie),
      body: JSON.stringify({
        date: '2026-09-01',
        description,
        postings: [
          { accountId, amount: '-10.00', currency: 'CAD' },
          { accountId: offset, amount: '10.00', currency: 'CAD' },
        ],
      }),
    })
    expect(res.status).toBe(201)
  }

  async function listed(accountPath: string): Promise<string[]> {
    const res = await request(`/api/transactions?accountPath=${encodeURIComponent(accountPath)}`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    return ((await res.json()) as { description: string }[]).map((t) => t.description).sort()
  }

  beforeEach(async () => {
    await spend(await created('Assets:Wise'), 'wise')
    await spend(await created('Assets:Wise:eur'), 'wise eur')
    await spend(await created('Assets:Wisely'), 'wisely')
    await spend(await created('Assets:Wise_x'), 'wise_x')
  })

  it('takes the node and its subtree, and nothing that only shares a prefix', async () => {
    expect(await listed('Assets:Wise')).toEqual(['wise', 'wise eur'])
  })

  it('gives the same answer for the path in any case', async () => {
    expect(await listed('assets:wise')).toEqual(['wise', 'wise eur'])
    expect(await listed('ASSETS:WISE:EUR')).toEqual(['wise eur'])
  })

  it('still reads `_` in a path as itself', async () => {
    expect(await listed('assets:wise_x')).toEqual(['wise_x'])
  })
})
