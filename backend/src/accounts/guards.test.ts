import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

// Guards on the per-account endpoints that nothing tested before they moved into
// `accounts/`: each one was removed in turn, and no test failed.

const json = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' })

async function account(cookie: string, path: string): Promise<string> {
  const res = await request('/api/accounts', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({ path }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function spend(cookie: string, from: string, to: string, amount: string) {
  const res = await request('/api/transactions', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({
      date: '2026-01-05',
      description: 'x',
      postings: [
        { accountId: from, amount: `-${amount}`, currency: 'CAD' },
        { accountId: to, amount, currency: 'CAD' },
      ],
    }),
  })
  expect(res.status).toBe(201)
}

describe("another user's account", () => {
  let mine: string
  let theirs: string
  let theirBank: string

  beforeEach(async () => {
    await clearDatabase()
    mine = await createTestUser()
    theirs = await createTestUser('other@example.com')
    theirBank = await account(theirs, 'assets:bank')
    const theirFood = await account(theirs, 'expenses:food')
    await spend(theirs, theirBank, theirFood, '42.10')
  })

  it('is not found on the balance-as-of endpoint, rather than answering with their balance', async () => {
    const res = await request(`/api/accounts/${theirBank}/balance?date=2026-12-31`, {
      headers: { Cookie: mine },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'ACCOUNT_NOT_FOUND' })

    // Their own request still sees it, so the 404 is about who asked.
    const own = await request(`/api/accounts/${theirBank}/balance?date=2026-12-31`, {
      headers: { Cookie: theirs },
    })
    expect(own.status).toBe(200)
  })

  it('is not found on the action-required endpoint', async () => {
    const res = await request(`/api/accounts/${theirBank}/action-required`, {
      headers: { Cookie: mine },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'ACCOUNT_NOT_FOUND' })
  })
})

describe('a deleted account', () => {
  it('is not found on the balance-as-of and action-required endpoints', async () => {
    await clearDatabase()
    const cookie = await createTestUser()
    const gone = await account(cookie, 'assets:old')
    expect(
      (await request(`/api/accounts/${gone}`, { method: 'DELETE', headers: json(cookie) })).status,
    ).toBe(204)

    for (const path of [`/${gone}/balance?date=2026-12-31`, `/${gone}/action-required`]) {
      const res = await request(`/api/accounts${path}`, { headers: { Cookie: cookie } })
      expect(res.status).toBe(404)
    }
  })
})

describe('deleting a default account', () => {
  it('refuses the conversion and adjustments defaults sign-up points at, naming each', async () => {
    await clearDatabase()
    const cookie = await createTestUser()
    const settings = (await (
      await request('/api/user-settings', { headers: { Cookie: cookie } })
    ).json()) as { defaultConversionAccountId: string; defaultAdjustmentsAccountId: string }

    for (const [id, role] of [
      [settings.defaultConversionAccountId, 'conversion'],
      [settings.defaultAdjustmentsAccountId, 'adjustments'],
    ] as const) {
      expect(id).toBeString()
      const res = await request(`/api/accounts/${id}`, { method: 'DELETE', headers: json(cookie) })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'ACCOUNT_IS_A_DEFAULT', detail: { roles: [role] } })
    }
  })
})
