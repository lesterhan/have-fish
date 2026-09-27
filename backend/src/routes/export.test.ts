import { beforeEach, describe, expect, it } from 'bun:test'
import { clearDatabase, createTestUser, request } from '../test-utils'

// The route: who gets which rows, and the answer's shape. The text itself is pinned by
// `export/journal.test.ts`, and a real hledger reads it in `export/hledger.test.ts`.

const json = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' })

async function account(cookie: string, path: string, type?: string): Promise<string> {
  const res = await request('/api/accounts', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify(type ? { path, type } : { path }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function spend(
  cookie: string,
  date: string,
  description: string,
  from: string,
  to: string,
  amount: string,
): Promise<string> {
  const res = await request('/api/transactions', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({
      date,
      description,
      postings: [
        { accountId: from, amount: `-${amount}`, currency: 'CAD' },
        { accountId: to, amount, currency: 'CAD' },
      ],
    }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const journal = (cookie: string, query = '') =>
  request(`/api/export/journal${query}`, { headers: { Cookie: cookie } })

const headers = (text: string) => text.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2}/.test(l))

describe('GET /api/export/journal', () => {
  let cookie: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
  })

  it('refuses a request without a session', async () => {
    const res = await request('/api/export/journal')
    expect(res.status).toBe(401)
  })

  it('answers a download that nothing caches', async () => {
    const res = await journal(cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="have-fish.journal"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toStartWith('; Exported from have-fish.')
  })

  it('exports every account with the type the app resolves, and every transaction', async () => {
    const bank = await account(cookie, 'assets:bank')
    const food = await account(cookie, 'expenses:food')
    // An atypical root with an override, a child that inherits it, and one with neither.
    await account(cookie, '储蓄', 'asset')
    const boc = await account(cookie, '储蓄:中国银行')
    const rent = await account(cookie, '花钱:房租')
    await account(cookie, 'equity:conversion', 'conversion')
    await spend(cookie, '2026-01-05', 'Groceries', bank, food, '42.10')
    await spend(cookie, '2026-01-06', 'Rent', boc, rent, '1500.00')

    const text = await (await journal(cookie)).text()
    // Sign-up seeds a few accounts of its own; these are the ones this test made.
    for (const line of [
      'account assets:bank  ; type:A',
      'account equity:conversion  ; type:V',
      'account expenses:food  ; type:X',
      'account 储蓄  ; type:A',
      'account 储蓄:中国银行  ; type:A',
      'account 花钱:房租',
    ]) {
      expect(text).toContain(`\n${line}\n`)
    }
    expect(text).toContain(
      '2026-01-05 Groceries\n    assets:bank  -42.10 CAD\n    expenses:food  42.10 CAD\n',
    )
    expect(text).toContain(
      '2026-01-06 Rent\n    储蓄:中国银行  -1500.00 CAD\n    花钱:房租  1500.00 CAD\n',
    )
  })

  it('bounds the transactions by date, inclusively, and still declares every account', async () => {
    const bank = await account(cookie, 'assets:bank')
    const food = await account(cookie, 'expenses:food')
    await spend(cookie, '2026-01-31', 'before', bank, food, '1.00')
    await spend(cookie, '2026-02-01', 'first day', bank, food, '1.00')
    await spend(cookie, '2026-02-28', 'last day', bank, food, '1.00')
    await spend(cookie, '2026-03-01', 'after', bank, food, '1.00')

    const both = await (await journal(cookie, '?from=2026-02-01&to=2026-02-28')).text()
    expect(headers(both)).toEqual(['2026-02-01 first day', '2026-02-28 last day'])
    expect(both).toContain('\naccount assets:bank  ; type:A\n')
    expect(both).toContain('\naccount expenses:food  ; type:X\n')

    const from = await (await journal(cookie, '?from=2026-02-28')).text()
    expect(headers(from)).toEqual(['2026-02-28 last day', '2026-03-01 after'])

    const to = await (await journal(cookie, '?to=2026-01-31')).text()
    expect(headers(to)).toEqual(['2026-01-31 before'])

    const empty = await (await journal(cookie, '?from=2027-01-01')).text()
    expect(headers(empty)).toEqual([])
    expect(empty).toContain('account assets:bank')
    expect(empty).not.toContain('commodity')
  })

  it('reads an empty bound as no bound', async () => {
    const bank = await account(cookie, 'assets:bank')
    const food = await account(cookie, 'expenses:food')
    await spend(cookie, '2026-01-31', 'only', bank, food, '1.00')
    const res = await journal(cookie, '?from=&to=')
    expect(res.status).toBe(200)
    expect(headers(await res.text())).toEqual(['2026-01-31 only'])
  })

  it('refuses a bound that is not a date', async () => {
    for (const [query, field] of [
      ['?from=2026-02-30', 'from'],
      ['?to=yesterday', 'to'],
      ['?from=2026-1-1', 'from'],
    ]) {
      const res = await journal(cookie, query)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'FIELD_NOT_DATE', detail: { field } })
    }
  })

  it('refuses bounds out of order', async () => {
    const res = await journal(cookie, '?from=2026-03-01&to=2026-02-01')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'RANGE_OUT_OF_ORDER',
      detail: { from: 'from', to: 'to' },
    })
  })

  it('leaves out deleted transactions and deleted accounts', async () => {
    const bank = await account(cookie, 'assets:bank')
    const food = await account(cookie, 'expenses:food')
    const gone = await account(cookie, 'expenses:gone')
    await spend(cookie, '2026-01-01', 'kept', bank, food, '1.00')
    const deleted = await spend(cookie, '2026-01-02', 'deleted', bank, food, '2.00')
    expect(
      (await request(`/api/transactions/${deleted}`, { method: 'DELETE', headers: json(cookie) }))
        .status,
    ).toBe(204)
    expect(
      (await request(`/api/accounts/${gone}`, { method: 'DELETE', headers: json(cookie) })).status,
    ).toBe(204)

    const text = await (await journal(cookie)).text()
    expect(headers(text)).toEqual(['2026-01-01 kept'])
    expect(text).not.toContain('2.00')
    expect(text).not.toContain('expenses:gone')
  })

  it("exports only the caller's own ledger", async () => {
    const bank = await account(cookie, 'assets:bank')
    const food = await account(cookie, 'expenses:food')
    await spend(cookie, '2026-01-01', 'mine', bank, food, '1.00')

    const other = await createTestUser('other@example.com')
    const theirBank = await account(other, 'assets:their-bank')
    const theirFood = await account(other, 'expenses:their-food')
    await spend(other, '2026-01-01', 'theirs', theirBank, theirFood, '9.00')

    const mine = await (await journal(cookie)).text()
    expect(headers(mine)).toEqual(['2026-01-01 mine'])
    expect(mine).not.toContain('their')

    const theirs = await (await journal(other)).text()
    expect(headers(theirs)).toEqual(['2026-01-01 theirs'])
    expect(theirs).not.toContain('assets:bank')
  })
})
