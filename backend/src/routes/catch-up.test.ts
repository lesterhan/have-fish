import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { accounts, postings, transactions, userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'

const today = () => new Date().toISOString().substring(0, 10)

function daysAgo(n: number): string {
  const d = new Date(`${today()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().substring(0, 10)
}

async function createAccount(userId: string, path: string, extra: { type?: string } = {}) {
  const [acct] = await db.insert(accounts).values({ userId, path, ...extra }).returning()
  return acct
}

async function userIdFor(cookie: string) {
  const res = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
  return (await res.json()).user.id as string
}

async function cover(cookie: string, accountId: string, fromDate: string, throughDate: string) {
  const res = await app.request('/api/coverage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ accountId, fromDate, throughDate, source: 'import' }),
  })
  if (res.status !== 201) throw new Error(`coverage write failed: ${res.status}`)
}

// One transaction on `date`, with a leg in the given account.
async function seedTxn(userId: string, accountId: string, date: string, expenseAccountId: string) {
  const [tx] = await db
    .insert(transactions)
    .values({ userId, date: new Date(`${date}T12:00:00Z`), description: 'test' })
    .returning()
  await db.insert(postings).values([
    { transactionId: tx.id, accountId, amount: '-10.00', currency: 'CAD' },
    { transactionId: tx.id, accountId: expenseAccountId, amount: '10.00', currency: 'CAD' },
  ])
  return tx
}

async function getCatchUp(cookie: string) {
  const res = await app.request('/api/catch-up', { headers: { Cookie: cookie } })
  return { status: res.status, body: await res.json() }
}

const find = (body: any, accountId: string) =>
  body.accounts.find((a: any) => a.accountId === accountId)

describe('catch-up', () => {
  let cookie: string
  let userId: string
  let groceries: { id: string }

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    userId = await userIdFor(cookie)
    groceries = await createAccount(userId, 'expenses:groceries')
  })

  describe('which accounts are tracked', () => {
    it('includes asset and liability accounts', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const visa = await createAccount(userId, 'liabilities:visa')

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.accountId).sort()).toEqual([chequing.id, visa.id].sort())
    })

    // Expense and income accounts are derived from postings, never imported — there is
    // nothing to catch up on.
    it('excludes expense and income accounts', async () => {
      await createAccount(userId, 'assets:chequing')
      await createAccount(userId, 'income:salary')

      const { body } = await getCatchUp(cookie)

      const paths = body.accounts.map((a: any) => a.path)
      expect(paths).toContain('assets:chequing')
      expect(paths).not.toContain('expenses:groceries')
      expect(paths).not.toContain('income:salary')
    })

    it('excludes equity accounts', async () => {
      await createAccount(userId, 'equity:adjustments')

      const { body } = await getCatchUp(cookie)

      expect(body.accounts).toHaveLength(0)
    })

    it('excludes soft-deleted accounts', async () => {
      const closed = await createAccount(userId, 'assets:closed')
      await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, closed.id))

      const { body } = await getCatchUp(cookie)

      expect(body.accounts).toHaveLength(0)
    })

    it('excludes hidden accounts', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const hidden = await createAccount(userId, 'assets:hidden')
      await db.update(userSettings)
        .set({ preferences: { hiddenAccountIds: [hidden.id] } })
        .where(eq(userSettings.userId, userId))

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.accountId)).toEqual([chequing.id])
    })

    // The illiquid-account epic is still backlog, so nothing writes this key yet — the coach
    // is ready for it.
    it('excludes illiquid accounts', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const fhsa = await createAccount(userId, 'assets:fhsa')
      await db.update(userSettings)
        .set({ preferences: { illiquidAccountIds: [fhsa.id] } })
        .where(eq(userSettings.userId, userId))

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.accountId)).toEqual([chequing.id])
    })

    it('excludes accounts dismissed with tracked false', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const ignored = await createAccount(userId, 'assets:ignored')
      await app.request(`/api/coverage/config/${ignored.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ tracked: false }),
      })

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.accountId)).toEqual([chequing.id])
    })

    // An atypically-named root can't be classified by path, but a stored type override can
    // still place it — the same escape hatch the rest of the app uses.
    it('includes an atypically-named account with a stored asset type', async () => {
      const savings = await createAccount(userId, '储蓄:中国银行', { type: 'asset' })
      await createAccount(userId, '花钱:房租')

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.accountId)).toEqual([savings.id])
    })

    it('respects a user\'s renamed asset root', async () => {
      await db.update(userSettings)
        .set({ defaultAssetsRootPath: 'stuff' })
        .where(eq(userSettings.userId, userId))
      const acct = await createAccount(userId, 'stuff:chequing')

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.accountId)).toEqual([acct.id])
    })

    it('never shows another user\'s accounts', async () => {
      const otherCookie = await createTestUser('other@example.com')
      await createAccount(await userIdFor(otherCookie), 'assets:theirs')
      const mine = await createAccount(userId, 'assets:mine')

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.accountId)).toEqual([mine.id])
    })

    it('requires authentication', async () => {
      const res = await app.request('/api/catch-up')

      expect(res.status).toBe(401)
    })
  })

  describe('state', () => {
    it('reads unset for an account with no coverage', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id)).toMatchObject({ state: 'unset', gap: null, coveredThrough: null })
    })

    it('reads current for an account covered through today', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(60), today())

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id)).toMatchObject({ state: 'current', gap: null, horizonReason: 'today' })
    })

    it('reads behind with a leading-edge gap', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(60), daysAgo(10))

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id)).toMatchObject({
        state: 'behind',
        coveredThrough: daysAgo(10),
        gap: { from: daysAgo(9), through: today(), days: 10 },
      })
    })

    // Out-of-order imports: the older hole stays in the data but never reaches the payload.
    it('reports only the leading edge when an older hole exists', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(120), daysAgo(90))
      await cover(cookie, chequing.id, daysAgo(30), daysAgo(5))

      const { body } = await getCatchUp(cookie)
      const account = find(body, chequing.id)

      expect(account.coveredThrough).toBe(daysAgo(5))
      expect(account.gap).toEqual({ from: daysAgo(4), through: today(), days: 5 })
      expect(JSON.stringify(account)).not.toContain(daysAgo(60))
    })

    it('merges consecutive statements into one leading edge', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(60), daysAgo(31))
      await cover(cookie, chequing.id, daysAgo(30), daysAgo(3))

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).gap).toEqual({ from: daysAgo(2), through: today(), days: 3 })
    })

    it('reads current for a cycle account covered to its statement horizon', async () => {
      const visa = await createAccount(userId, 'liabilities:visa')
      await app.request(`/api/coverage/config/${visa.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ exportMode: 'cycle', cycleDay: 25 }),
      })

      const { body } = await getCatchUp(cookie)
      const horizon = find(body, visa.id).horizon
      await cover(cookie, visa.id, daysAgo(120), horizon)

      const after = await getCatchUp(cookie)
      expect(find(after.body, visa.id)).toMatchObject({ state: 'current', horizonReason: 'statement' })
      expect(find(after.body, visa.id).nextHorizonDate).toBeString()
    })
  })

  describe('transactions inside the gap', () => {
    it('reports the dates that already have transactions', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(60), daysAgo(20))
      await seedTxn(userId, chequing.id, daysAgo(30), groceries.id)  // inside coverage
      await seedTxn(userId, chequing.id, daysAgo(15), groceries.id)  // inside the gap
      await seedTxn(userId, chequing.id, daysAgo(4), groceries.id)   // inside the gap

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).txnDatesInGap).toEqual([daysAgo(15), daysAgo(4)])
    })

    it('does not attribute another account\'s transactions to this one', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const visa = await createAccount(userId, 'liabilities:visa')
      await cover(cookie, chequing.id, daysAgo(60), daysAgo(20))
      await cover(cookie, visa.id, daysAgo(60), daysAgo(20))
      await seedTxn(userId, visa.id, daysAgo(10), groceries.id)

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).txnDatesInGap).toEqual([])
      expect(find(body, visa.id).txnDatesInGap).toEqual([daysAgo(10)])
    })

    it('ignores soft-deleted transactions', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(60), daysAgo(20))
      const tx = await seedTxn(userId, chequing.id, daysAgo(10), groceries.id)
      await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, tx.id))

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).txnDatesInGap).toEqual([])
    })

    it('sees transactions inside a gap older than the rate window', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(900), daysAgo(800))
      await seedTxn(userId, chequing.id, daysAgo(700), groceries.id)

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).txnDatesInGap).toContain(daysAgo(700))
    })
  })

  describe('estimates and ranking', () => {
    it('estimates the work in a gap from the covered rate', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      // 40 covered days (day -50 through -11 inclusive) with one transaction each: 1/day.
      await cover(cookie, chequing.id, daysAgo(50), daysAgo(11))
      for (let i = 11; i <= 50; i++) await seedTxn(userId, chequing.id, daysAgo(i), groceries.id)

      const { body } = await getCatchUp(cookie)
      const account = find(body, chequing.id)

      // The gap runs day -10 through today, inclusive on both ends.
      expect(account.gap.days).toBe(11)
      expect(account.expectedTxns).toBe(11)
    })

    it('orders smallest gap first with dormant accounts last', async () => {
      const small = await createAccount(userId, 'assets:small-gap')
      const big = await createAccount(userId, 'assets:big-gap')
      const quiet = await createAccount(userId, 'assets:quiet')

      await cover(cookie, small.id, daysAgo(90), daysAgo(3))
      await seedTxn(userId, small.id, daysAgo(20), groceries.id)
      await cover(cookie, big.id, daysAgo(90), daysAgo(40))
      await seedTxn(userId, big.id, daysAgo(50), groceries.id)
      // Covered and confirmed empty — the dormant case.
      await cover(cookie, quiet.id, daysAgo(200), daysAgo(1))

      const { body } = await getCatchUp(cookie)

      expect(body.accounts.map((a: any) => a.path)).toEqual([
        'assets:small-gap', 'assets:big-gap', 'assets:quiet',
      ])
      expect(find(body, quiet.id).dormant).toBe(true)
      expect(find(body, small.id).dormant).toBe(false)
    })

    it('revives a dormant account when a transaction lands in its gap', async () => {
      const wise = await createAccount(userId, 'assets:wise:eur')
      await cover(cookie, wise.id, daysAgo(200), daysAgo(20))

      const before = await getCatchUp(cookie)
      expect(find(before.body, wise.id).dormant).toBe(true)

      await seedTxn(userId, wise.id, daysAgo(10), groceries.id)

      const after = await getCatchUp(cookie)
      expect(find(after.body, wise.id).dormant).toBe(false)
    })
  })

  describe('strip data', () => {
    it('carries a 90-day window ending today', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).strip).toMatchObject({
        from: daysAgo(89), to: today(), days: 90,
      })
    })

    it('clips coverage to the window it can actually draw', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(400), daysAgo(10))

      const { strip } = find((await getCatchUp(cookie)).body, chequing.id)

      expect(strip.intervals).toEqual([{ fromDate: daysAgo(89), throughDate: daysAgo(10) }])
    })

    it('merges adjacent coverage before clipping', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(60), daysAgo(31))
      await cover(cookie, chequing.id, daysAgo(30), daysAgo(10))

      const { strip } = find((await getCatchUp(cookie)).body, chequing.id)

      expect(strip.intervals).toEqual([{ fromDate: daysAgo(60), throughDate: daysAgo(10) }])
    })

    it('keeps a hole between disjoint spans', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(80), daysAgo(60))
      await cover(cookie, chequing.id, daysAgo(30), daysAgo(10))

      const { strip } = find((await getCatchUp(cookie)).body, chequing.id)

      expect(strip.intervals).toEqual([
        { fromDate: daysAgo(80), throughDate: daysAgo(60) },
        { fromDate: daysAgo(30), throughDate: daysAgo(10) },
      ])
    })

    // The strip marks every day with transactions, not only the ones inside the open gap.
    it('reports transaction dates across the whole window', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await cover(cookie, chequing.id, daysAgo(60), daysAgo(20))
      await seedTxn(userId, chequing.id, daysAgo(40), groceries.id)  // covered
      await seedTxn(userId, chequing.id, daysAgo(5), groceries.id)   // in the gap
      await seedTxn(userId, chequing.id, daysAgo(200), groceries.id) // outside the window

      const account = find((await getCatchUp(cookie)).body, chequing.id)

      expect(account.strip.txnDates).toEqual([daysAgo(40), daysAgo(5)])
      expect(account.txnDatesInGap).toEqual([daysAgo(5)])
    })

    it('is empty but present for an account with no coverage', async () => {
      const fresh = await createAccount(userId, 'assets:fresh')

      const { strip } = find((await getCatchUp(cookie)).body, fresh.id)

      expect(strip.intervals).toEqual([])
      expect(strip.txnDates).toEqual([])
    })
  })

  describe('history span', () => {
    it('reports the first and last transaction dates', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await seedTxn(userId, chequing.id, daysAgo(40), groceries.id)
      await seedTxn(userId, chequing.id, daysAgo(12), groceries.id)
      await seedTxn(userId, chequing.id, daysAgo(25), groceries.id)

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id)).toMatchObject({
        firstTxnDate: daysAgo(40),
        lastTxnDate: daysAgo(12),
      })
    })

    it('is null for an account with no transactions', async () => {
      const empty = await createAccount(userId, 'assets:untouched')

      const { body } = await getCatchUp(cookie)

      expect(find(body, empty.id)).toMatchObject({ firstTxnDate: null, lastTxnDate: null })
    })

    // Unbounded by the rate window on purpose — bootstrap proposes the whole existing ledger,
    // which routinely predates any window an estimate would care about.
    it('reaches back past the rate window', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      await seedTxn(userId, chequing.id, daysAgo(1200), groceries.id)
      await seedTxn(userId, chequing.id, daysAgo(3), groceries.id)

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).firstTxnDate).toBe(daysAgo(1200))
    })

    it('ignores soft-deleted transactions', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const old = await seedTxn(userId, chequing.id, daysAgo(400), groceries.id)
      await seedTxn(userId, chequing.id, daysAgo(10), groceries.id)
      await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, old.id))

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).firstTxnDate).toBe(daysAgo(10))
    })

    it('does not borrow another account\'s history', async () => {
      const chequing = await createAccount(userId, 'assets:chequing')
      const visa = await createAccount(userId, 'liabilities:visa')
      await seedTxn(userId, visa.id, daysAgo(90), groceries.id)
      await seedTxn(userId, chequing.id, daysAgo(10), groceries.id)

      const { body } = await getCatchUp(cookie)

      expect(find(body, chequing.id).firstTxnDate).toBe(daysAgo(10))
      expect(find(body, visa.id).firstTxnDate).toBe(daysAgo(90))
    })
  })

  describe('summary', () => {
    it('counts states and reports progress', async () => {
      const current = await createAccount(userId, 'assets:current')
      const behind = await createAccount(userId, 'assets:behind')
      await createAccount(userId, 'assets:untouched')
      await cover(cookie, current.id, daysAgo(30), today())
      await cover(cookie, behind.id, daysAgo(30), daysAgo(5))

      const { body } = await getCatchUp(cookie)

      expect(body.summary).toMatchObject({
        current: 1, behind: 1, unset: 1, tracked: 3,
        accountsToCatchUp: 1,
        progress: { current: 1, tracked: 3 },
      })
    })

    it('is empty for a user with no tracked accounts', async () => {
      const { status, body } = await getCatchUp(cookie)

      expect(status).toBe(200)
      expect(body.accounts).toEqual([])
      expect(body.summary).toMatchObject({ tracked: 0, accountsToCatchUp: 0 })
    })

    it('reports today so the client and server agree on the date', async () => {
      const { body } = await getCatchUp(cookie)

      expect(body.today).toBe(today())
    })
  })
})
