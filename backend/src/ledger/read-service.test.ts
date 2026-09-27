import { describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

// A filter on GET /api/transactions that matches nothing answers nothing. Before the move
// into `read-service`, answering every transaction instead failed no test.

const json = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' })

describe('GET /api/transactions?accountPath=', () => {
  it('is empty for a path no account sits at or under', async () => {
    await clearDatabase()
    const cookie = await createTestUser()
    const ids: string[] = []
    for (const path of ['assets:bank', 'expenses:food']) {
      const res = await request('/api/accounts', {
        method: 'POST',
        headers: json(cookie),
        body: JSON.stringify({ path }),
      })
      ids.push(((await res.json()) as { id: string }).id)
    }
    const created = await request('/api/transactions', {
      method: 'POST',
      headers: json(cookie),
      body: JSON.stringify({
        date: '2026-01-05',
        description: 'Groceries',
        postings: [
          { accountId: ids[0], amount: '-4.00', currency: 'CAD' },
          { accountId: ids[1], amount: '4.00', currency: 'CAD' },
        ],
      }),
    })
    expect(created.status).toBe(201)

    const list = (path: string) =>
      request(`/api/transactions?accountPath=${encodeURIComponent(path)}`, {
        headers: { Cookie: cookie },
      }).then((r) => r.json() as Promise<unknown[]>)

    expect(await list('expenses:food')).toHaveLength(1)
    expect(await list('expenses:fo')).toEqual([])
    expect(await list('liabilities')).toEqual([])
  })
})
