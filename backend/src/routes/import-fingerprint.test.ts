import { beforeEach, describe, expect, it } from 'bun:test'
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { groupExpenses, transactions } from '../db/schema'
import { importFingerprint, importTransactionId } from '../import/fingerprint'
import { clearDatabase, createTestUser, request } from '../test-utils'

// #282: an imported row carries a fingerprint of the bank row it came from, and takes its
// id from it, so importing the same statement twice writes nothing the second time.

const PARSER = {
  name: 'Test Bank',
  normalizedHeader: 'amount|date|description',
  columnMapping: { date: 'date', amount: 'amount', description: 'description' },
}

const STATEMENT = `Date,Amount,Description
2026-02-01,-4.50,STARBUCKS #123
2026-02-01,-4.50,STARBUCKS #123
2026-02-02,2500.00,Salary`

type PreviewRow = { date: string; amount: string; description?: string; importKey: string }

let cookie: string
let userId: string
let chequing: string
let food: string

async function json<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await request(path, {
    ...init,
    headers: { Cookie: cookie, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  return { status: res.status, body: (await res.json()) as T }
}

async function account(path: string): Promise<string> {
  return (
    await json<{ id: string }>('/api/accounts', { method: 'POST', body: JSON.stringify({ path }) })
  ).body.id
}

async function preview(csv: string): Promise<PreviewRow[]> {
  const form = new FormData()
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'export.csv')
  form.append('defaultCurrency', 'CAD')
  const res = await request('/api/import/preview', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { transactions: PreviewRow[] }).transactions
}

async function commit(rows: PreviewRow[], accountId = chequing, extra: object = {}) {
  return json<{ created: number; skipped: number; fishPieExpenses: number; error?: string }>(
    '/api/import/commit',
    {
      method: 'POST',
      body: JSON.stringify({
        accountId,
        defaultCurrency: 'CAD',
        transactions: rows.map((r) => ({ ...r, isTransfer: false, offsetAccountId: food })),
        ...extra,
      }),
    },
  )
}

async function importedCount(): Promise<number> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(isNotNull(transactions.importFingerprint))
  return rows.length
}

beforeEach(async () => {
  await clearDatabase()
  cookie = await createTestUser()
  const session = await json<{ user: { id: string } }>('/api/auth/get-session')
  userId = session.body.user.id
  await json('/api/parsers', { method: 'POST', body: JSON.stringify(PARSER) })
  chequing = await account('assets:chequing')
  food = await account('expenses:food')
})

describe('importing the same statement twice', () => {
  it('writes every row the first time, identical rows included, and nothing the second', async () => {
    const first = await commit(await preview(STATEMENT))
    expect(first.status).toBe(201)
    expect(first.body).toEqual({ created: 3, skipped: 0, fishPieExpenses: 0 })

    const second = await commit(await preview(STATEMENT))
    expect(second.status).toBe(201)
    expect(second.body).toEqual({ created: 0, skipped: 3, fishPieExpenses: 0 })
    expect(await importedCount()).toBe(3)
  })

  it('still writes nothing when the bank changes the description’s spacing or case', async () => {
    await commit(await preview(STATEMENT))
    const respaced = STATEMENT.replaceAll('STARBUCKS #123', '  starbucks   #123 ').replace(
      'Salary',
      'SALARY',
    )
    expect((await commit(await preview(respaced))).body).toMatchObject({ created: 0, skipped: 3 })
  })

  it('writes only the new rows of an overlapping statement', async () => {
    await commit(await preview(STATEMENT))
    const next = `${STATEMENT}\n2026-02-03,-60.00,Groceries`
    expect((await commit(await preview(next))).body).toMatchObject({ created: 1, skipped: 3 })
  })

  it('gives each row an id derived from its fingerprint', async () => {
    const [row] = await preview(STATEMENT)
    await commit(row ? [row] : [])
    const fingerprint = importFingerprint(chequing, row?.importKey ?? '')
    const [stored] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.importFingerprint, fingerprint))
    expect(stored?.id).toBe(importTransactionId(userId, fingerprint))
  })

  it('does not bring back a deleted import', async () => {
    const rows = await preview(STATEMENT)
    await commit(rows)
    const [one] = await db.select({ id: transactions.id }).from(transactions).limit(1)
    const deleted = await request(`/api/transactions/${one?.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(deleted.status).toBe(204)
    expect((await commit(rows)).body).toMatchObject({ created: 0, skipped: 3 })
  })

  it('writes a row sent without its key, as a manual import', async () => {
    const rows = await preview(STATEMENT)
    await commit(rows)
    const [row] = rows
    const { importKey: _, ...unkeyed } = row ?? ({} as PreviewRow)
    expect((await commit([unkeyed as PreviewRow])).body).toMatchObject({ created: 1, skipped: 0 })
  })

  it('keeps two accounts that share a parser apart', async () => {
    const savings = await account('assets:savings')
    const fee = '2026-02-01,-4.00,MONTHLY FEE'
    await commit(await preview(`Date,Amount,Description\n${fee}`), chequing)
    expect(
      (await commit(await preview(`Date,Amount,Description\n${fee}`), savings)).body,
    ).toMatchObject({ created: 1, skipped: 0 })
  })

  it('creates one Fish Pie expense for a split row imported twice', async () => {
    const group = await json<{ id: string }>('/api/fish-pie/groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Flat' }),
    })
    const rows = (await preview(STATEMENT)).slice(2)
    const splits = { groupSplits: [{ rowIndex: 0, groupId: group.body.id }] }
    expect((await commit(rows, chequing, splits)).body).toMatchObject({ fishPieExpenses: 1 })
    expect((await commit(rows, chequing, splits)).body).toMatchObject({
      created: 0,
      skipped: 1,
      fishPieExpenses: 0,
    })
    const expenses = await db
      .select({ id: groupExpenses.id })
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, group.body.id)))
    expect(expenses).toHaveLength(1)
  })

  it('refuses a key that is not one', async () => {
    const [row] = await preview(STATEMENT)
    const res = await commit([{ ...(row as PreviewRow), importKey: 'not-a-key' }])
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('FIELD_INVALID')
  })
})

describe('POST /api/import/check-duplicates, by fingerprint', () => {
  const check = (rows: object[]) =>
    json<{ duplicates: (Record<string, unknown> | null)[] }>('/api/import/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })

  it('reports a row already imported as certain, with the transaction it is', async () => {
    const rows = await preview(STATEMENT)
    await commit(rows)
    const { status, body } = await check(
      rows.map((r) => ({
        accountId: chequing,
        date: r.date,
        amount: r.amount,
        currency: 'CAD',
        importKey: r.importKey,
        importAccountId: chequing,
      })),
    )
    expect(status).toBe(200)
    for (const [i, duplicate] of body.duplicates.entries()) {
      const fingerprint = importFingerprint(chequing, rows[i]?.importKey ?? '')
      expect(duplicate).toMatchObject({
        transactionId: importTransactionId(userId, fingerprint),
        certain: true,
        currency: 'CAD',
      })
    }
    expect(body.duplicates[2]).toMatchObject({ date: '2026-02-02', amount: '2500.00' })
  })

  it('checks a transfer row by fingerprint, which the guess never did', async () => {
    const rows = await preview(STATEMENT)
    await commit(rows)
    const [row] = rows
    const { body } = await check([
      {
        accountId: '',
        date: row?.date,
        amount: '0',
        currency: 'CAD',
        importKey: row?.importKey,
        importAccountId: chequing,
      },
    ])
    expect(body.duplicates[0]).toMatchObject({ certain: true, amount: '-4.50' })
  })

  it('leaves the guess alone for a row never imported, or checked against another account', async () => {
    const rows = await preview(STATEMENT)
    const [row] = rows
    const probe = {
      accountId: chequing,
      date: row?.date,
      amount: row?.amount,
      currency: 'CAD',
      importKey: row?.importKey,
      importAccountId: chequing,
    }
    expect((await check([probe])).body.duplicates).toEqual([null])

    await commit(rows)
    const savings = await account('assets:savings')
    const { body } = await check([{ ...probe, accountId: savings, importAccountId: savings }])
    expect(body.duplicates).toEqual([null])
  })
})
