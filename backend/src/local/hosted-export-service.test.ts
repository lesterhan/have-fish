// The one-time copy out of the hosted edition (#289). It reads Postgres, so it runs in the
// server build's suite and skips in the SQLite one; the file it writes is read back here with
// the local build's own schema, and `adopt-service.test.ts` opens one the way the binary does.

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { dialect } from '../db'
import { db as hosted } from '../db/pg/client'
import * as pg from '../db/pg/schema'
import { migrateSqliteFile, readMigrations } from '../db/sqlite/migrate'
import * as lite from '../db/sqlite/schema'
import { accountAt, clearDatabase, createTestUser, request } from '../test-utils'
import { balances, ExportRefused, exportLedger } from './hosted-export-service'

const dir = mkdtempSync(join(tmpdir(), 'havefish-export-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const outFile = () => join(dir, `ledger-${++n}.sqlite`)

/** The written file, through the local build's schema. */
function open(path: string) {
  const client = createClient({ url: `file:${path}` })
  return { local: drizzle(client, { schema: lite }), close: () => client.close() }
}

async function post(cookie: string, path: string, body: unknown): Promise<{ id: string }> {
  const res = await request(path, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

/** Someone with a small ledger in two currencies, built through the API. */
async function someone(email: string) {
  const cookie = await createTestUser(email)
  const cash = await post(cookie, '/api/accounts', { path: 'assets:cash', defaultCurrency: 'CAD' })
  const eur = await post(cookie, '/api/accounts', { path: 'assets:wise:eur' })
  const food = await post(cookie, '/api/accounts', { path: 'expenses:food' })
  const lunch = await post(cookie, '/api/transactions', {
    date: '2026-08-01',
    description: 'Lunch',
    postings: [
      { accountId: cash.id, amount: '-12.50', currency: 'CAD' },
      { accountId: food.id, amount: '12.50', currency: 'CAD' },
    ],
  })
  await post(cookie, '/api/transactions', {
    date: '2026-08-02',
    description: 'Crêpe',
    postings: [
      { accountId: eur.id, amount: '-4.20', currency: 'EUR' },
      { accountId: food.id, amount: '4.20', currency: 'EUR' },
    ],
  })
  const [me] = await hosted.select().from(pg.user).where(eq(pg.user.email, email))
  if (!me) throw new Error(`no user ${email}`)
  return { cookie, me, cash, eur, food, lunch }
}

describe.skipIf(dialect !== 'pg')('copying a hosted ledger to a local file', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it("copies one person's ledger with every id unchanged, and nobody else's", async () => {
    const you = await someone('you@example.com')
    await someone('partner@example.com')
    await hosted.insert(pg.fxRates).values({
      date: '2026-08-02',
      baseCurrency: 'EUR',
      quoteCurrency: 'CAD',
      rate: '1.512300',
    })

    const out = outFile()
    const summary = await exportLedger(hosted, { email: 'you@example.com', out })
    expect(summary.userId).toBe(you.me.id)
    expect(summary.droppedRules).toEqual([])

    const { local, close } = open(out)
    try {
      expect((await local.select().from(lite.user)).map((u) => u.id)).toEqual([you.me.id])
      expect(await local.select().from(lite.localProfile)).toEqual([
        { id: 'local', userId: you.me.id, createdAt: expect.any(Date) },
      ])

      const hostedAccounts = await hosted
        .select()
        .from(pg.accounts)
        .where(eq(pg.accounts.userId, you.me.id))
      const localAccounts = await local.select().from(lite.accounts)
      expect(localAccounts.map((a) => a.id).sort()).toEqual(hostedAccounts.map((a) => a.id).sort())
      // The sign-up's three and the three above.
      expect(localAccounts).toHaveLength(6)

      const txs = await local.select().from(lite.transactions)
      expect(txs.map((t) => t.description).sort()).toEqual(['Crêpe', 'Lunch'])
      expect(txs.find((t) => t.description === 'Lunch')?.id).toBe(you.lunch.id)
      expect(txs.every((t) => t.userId === you.me.id)).toBe(true)

      const legs = await local.select().from(lite.postings)
      expect(legs).toHaveLength(4)
      expect(legs.find((p) => p.accountId === you.cash.id)).toMatchObject({
        amount: '-12.50',
        currency: 'CAD',
      })

      const [settings] = await local.select().from(lite.userSettings)
      expect(settings?.userId).toBe(you.me.id)
      expect(settings?.preferences).toEqual({})
      expect(await local.select().from(lite.fxRates)).toMatchObject([
        { date: '2026-08-02', baseCurrency: 'EUR', quoteCurrency: 'CAD', rate: '1.512300' },
      ])
    } finally {
      close()
    }
    expect(summary.rows).toMatchObject({ user: 1, accounts: 6, transactions: 2, postings: 4 })
    expect(summary.balancesChecked).toBe(4)
  })

  it('writes a file the local build takes as already migrated and already set up', async () => {
    await someone('you@example.com')
    const out = outFile()
    await exportLedger(hosted, { email: 'you@example.com', out })
    expect(await migrateSqliteFile(out, readMigrations())).toEqual({ applied: [], backup: null })
    expect(existsSync(`${out}.partial`)).toBe(false)
  })

  it('carries what was deleted too, so the file is a copy and not a summary', async () => {
    const you = await someone('you@example.com')
    const res = await request(`/api/transactions/${you.lunch.id}`, {
      method: 'DELETE',
      headers: { Cookie: you.cookie },
    })
    expect(res.status).toBeLessThan(300)

    const out = outFile()
    const summary = await exportLedger(hosted, { email: 'you@example.com', out })
    const { local, close } = open(out)
    try {
      const [lunch] = await local
        .select()
        .from(lite.transactions)
        .where(eq(lite.transactions.id, you.lunch.id))
      expect(lunch?.deletedAt).toBeInstanceOf(Date)
    } finally {
      close()
    }
    // Only the crêpe's two legs still count.
    expect(summary.balancesChecked).toBe(2)
  })

  it("leaves Fish Pie behind: a rule into a group is dropped, a transaction's link is cleared", async () => {
    const you = await someone('you@example.com')
    const [group] = await hosted
      .insert(pg.expenseGroups)
      .values({ name: 'Household', createdBy: you.me.id })
      .returning()
    if (!group) throw new Error('insert expense_groups returned nothing')
    await hosted.insert(pg.importRules).values([
      { userId: you.me.id, pattern: 'COSTCO', groupId: group.id },
      { userId: you.me.id, pattern: 'TIM HORTONS', accountId: you.food.id },
    ])
    await hosted
      .update(pg.transactions)
      .set({ groupExpenseId: crypto.randomUUID() })
      .where(eq(pg.transactions.id, you.lunch.id))

    const out = outFile()
    const summary = await exportLedger(hosted, { email: 'you@example.com', out })
    expect(summary.droppedRules).toEqual(['COSTCO'])

    const { local, close } = open(out)
    try {
      expect((await local.select().from(lite.importRules)).map((r) => r.pattern)).toEqual([
        'TIM HORTONS',
      ])
      expect(await local.select().from(lite.expenseGroups)).toEqual([])
      const txs = await local.select().from(lite.transactions)
      expect(txs.map((t) => t.groupExpenseId)).toEqual([null, null])
    } finally {
      close()
    }
  })

  it('refuses an address hosted does not know, and writes nothing', async () => {
    await someone('you@example.com')
    const out = outFile()
    await expect(exportLedger(hosted, { email: 'nobody@example.com', out })).rejects.toThrow(
      ExportRefused,
    )
    expect(existsSync(out)).toBe(false)
    expect(existsSync(`${out}.partial`)).toBe(false)
  })

  it('will not replace a file that is already there, unless told to', async () => {
    await someone('you@example.com')
    const out = outFile()
    writeFileSync(out, 'something precious')
    await expect(exportLedger(hosted, { email: 'you@example.com', out })).rejects.toThrow(
      /already exists/,
    )
    await exportLedger(hosted, { email: 'you@example.com', out, force: true })
    const { local, close } = open(out)
    try {
      expect(await local.select().from(lite.transactions)).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('reads the accounts the sign-up made, which a new local profile would have made again', async () => {
    const you = await someone('you@example.com')
    const out = outFile()
    await exportLedger(hosted, { email: 'you@example.com', out })
    const uncategorized = await accountAt(you.cookie, 'expenses:uncategorized')
    const { local, close } = open(out)
    try {
      const [settings] = await local.select().from(lite.userSettings)
      expect(settings?.defaultOffsetAccountId).toBe(uncategorized.id)
    } finally {
      close()
    }
  })
})

describe('the balances the copy is checked against', () => {
  const tx = (id: string, deletedAt: Date | null = null) => ({ id, deletedAt })
  const leg = (transactionId: string, accountId: string, amount: string, deleted = false) => ({
    id: crypto.randomUUID(),
    transactionId,
    accountId,
    amount,
    currency: 'CAD',
    deletedAt: deleted ? new Date() : null,
  })

  it('sums each account per currency, to the cent', () => {
    const got = balances(
      [tx('a'), tx('b')],
      [leg('a', 'cash', '-0.10'), leg('a', 'food', '0.10'), leg('b', 'cash', '-0.20')],
    )
    expect(Object.fromEntries(got)).toEqual({ 'cash CAD': '-0.30', 'food CAD': '0.10' })
  })

  it('leaves out deleted transactions and deleted legs, as every report does', () => {
    const got = balances(
      [tx('a'), tx('b', new Date())],
      [leg('a', 'cash', '-5.00'), leg('a', 'cash', '-1.00', true), leg('b', 'cash', '-9.00')],
    )
    expect(Object.fromEntries(got)).toEqual({ 'cash CAD': '-5.00' })
  })
})
