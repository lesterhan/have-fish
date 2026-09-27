import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { transactions } from '../db/schema'
import { clearDatabase, createTestUser, request } from '../test-utils'

// #277 / things-missed M1: a transaction's date is the day the user or the bank wrote, on
// whatever machine the backend runs. In UTC these pass trivially; `bun run test:zones` (and
// CI) runs this file in Tokyo and Los Angeles, the two directions the old timestamp column
// got the day wrong. Bun ignores a TZ change after the first in a process, so the zone is
// set when the process starts, not here.

let cookie: string
let chequing: string
let food: string

async function post(path: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  await clearDatabase()
  cookie = await createTestUser()
  chequing = (
    (await (await post('/api/accounts', { path: 'assets:chequing' })).json()) as { id: string }
  ).id
  food = ((await (await post('/api/accounts', { path: 'expenses:food' })).json()) as { id: string })
    .id
})

async function listDates(query = '') {
  const res = await request(`/api/transactions${query}`, { headers: { Cookie: cookie } })
  expect(res.status).toBe(200)
  return ((await res.json()) as { date: string }[]).map((t) => t.date).sort()
}

describe('a transaction keeps its day in every time zone', () => {
  it('entered at 23:30 on a UTC-7 machine, is dated that day', async () => {
    // The web app sends the day from its date input; 23:30 local is 06:30 the next day UTC.
    const res = await post('/api/transactions', {
      date: '2026-09-12',
      description: 'Late dinner',
      postings: [
        { accountId: chequing, amount: '-30.00', currency: 'CAD' },
        { accountId: food, amount: '30.00', currency: 'CAD' },
      ],
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { date: string }).date).toBe('2026-09-12')
    expect(await listDates()).toEqual(['2026-09-12'])
    expect(await listDates('?from=2026-09-12&to=2026-09-12')).toEqual(['2026-09-12'])
    expect(await listDates('?to=2026-09-11')).toEqual([])
  })

  it('imported from a CSV with US dates, is dated as the bank wrote', async () => {
    await post('/api/parsers', {
      name: 'US Bank',
      normalizedHeader: 'amount|date|description',
      columnMapping: { date: 'date', amount: 'amount', description: 'description' },
    })
    const form = new FormData()
    const csv = 'Date,Amount,Description\n09/12/2026,-4.50,Coffee\n12/31/2026,-9.00,Party\n'
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'export.csv')
    form.append('defaultCurrency', 'CAD')
    const preview = await request('/api/import/preview', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    })
    const rows = ((await preview.json()) as { transactions: { date: string }[] }).transactions
    expect(rows.map((r) => r.date)).toEqual(['2026-09-12', '2026-12-31'])

    const commit = await post('/api/import/commit', {
      accountId: chequing,
      defaultCurrency: 'CAD',
      transactions: rows.map((r) => ({ ...r, isTransfer: false, offsetAccountId: food })),
    })
    expect(commit.status).toBe(201)
    expect(await listDates()).toEqual(['2026-09-12', '2026-12-31'])
  })

  it('edited, keeps the day it was given', async () => {
    const created = await post('/api/transactions', {
      date: '2026-01-01',
      postings: [
        { accountId: chequing, amount: '-1.00', currency: 'CAD' },
        { accountId: food, amount: '1.00', currency: 'CAD' },
      ],
    })
    const { id } = (await created.json()) as { id: string }
    const patched = await request(`/api/transactions/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-12-31' }),
    })
    expect(patched.status).toBe(200)
    const [row] = await db
      .select({ date: transactions.date })
      .from(transactions)
      .where(eq(transactions.id, id))
    expect(row?.date).toBe('2025-12-31')
  })

  it('is refused when the day does not exist', async () => {
    const res = await post('/api/transactions', {
      date: '2026-02-30',
      postings: [
        { accountId: chequing, amount: '-1.00', currency: 'CAD' },
        { accountId: food, amount: '1.00', currency: 'CAD' },
      ],
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'FIELD_NOT_DATE', detail: { field: 'date' } })
  })
})
