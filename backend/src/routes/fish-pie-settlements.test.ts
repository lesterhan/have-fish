import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { transactions, postings, accounts, groupSettlements } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'

describe('fish-pie settlements', () => {
  let cookieA: string
  let cookieB: string
  let groupId: string
  let userAId: string
  let userBId: string
  let accountAId: string
  let accountBId: string

  beforeEach(async () => {
    await clearDatabase()

    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')

    const sessionA = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    userAId = ((await sessionA.json()) as any).user.id
    userBId = ((await sessionB.json()) as any).user.id

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip' }),
    })
    groupId = ((await groupRes.json()) as any).id

    const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@test.com' }),
    })
    const inviteId = ((await invRes.json()) as any).id
    await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: { Cookie: cookieB },
    })

    // Create chequing accounts for both users
    const accA = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets:chequing' }),
    })
    accountAId = ((await accA.json()) as any).id

    const accB = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets:chequing' }),
    })
    accountBId = ((await accB.json()) as any).id
  })

  // Helper: B proposes settlement to A (B is payer, must use cookieB)
  async function proposeSettlement(amount = '30.00') {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements`, {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUserId: userBId,
        toUserId: userAId,
        amount,
        currency: 'CAD',
        date: '2026-04-28',
        payerAccountId: accountBId,
      }),
    })
    return res
  }

  it('POST creates pending settlement with payer transaction', async () => {
    const res = await proposeSettlement()
    expect(res.status).toBe(201)
    const s = (await res.json()) as any
    expect(s.amount).toBe('30.00')
    expect(s.currency).toBe('CAD')
    expect(s.status).toBe('pending')
    expect(s.payerTransactionId).toBeTruthy()

    // Payer's transaction should exist with two balanced postings
    const txRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, s.payerTransactionId), isNull(transactions.deletedAt)))
    expect(txRows).toHaveLength(1)
    expect(txRows[0].userId).toBe(userBId)

    const postingRows = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, s.payerTransactionId), isNull(postings.deletedAt)))
    expect(postingRows).toHaveLength(2)
    const amounts = postingRows.map((p) => parseFloat(p.amount))
    expect(amounts.find((a) => a < 0)).toBeCloseTo(-30, 1)
    expect(amounts.find((a) => a > 0)).toBeCloseTo(30, 1)
  })

  it('POST requires payerAccountId', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements`, {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: userBId, toUserId: userAId, amount: '30.00', currency: 'CAD', date: '2026-04-28' }),
    })
    expect(res.status).toBe(400)
  })

  it('only payer (fromUserId) can initiate a settlement', async () => {
    // cookieA tries to create a settlement where B is the payer — forbidden
    const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUserId: userBId,
        toUserId: userAId,
        amount: '30.00',
        currency: 'CAD',
        date: '2026-04-28',
        payerAccountId: accountBId,
      }),
    })
    expect(res.status).toBe(403)
  })

  it('payerAccountId must belong to fromUser', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements`, {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUserId: userBId,
        toUserId: userAId,
        amount: '30.00',
        currency: 'CAD',
        date: '2026-04-28',
        payerAccountId: accountAId, // wrong user's account
      }),
    })
    expect(res.status).toBe(400)
  })

  it('pending settlement excluded from balance until confirmed', async () => {
    // Create an expense so balance has something
    await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-04-27', paidByUserId: userAId }),
    })

    const balBefore = await app.request(`/api/fish-pie/groups/${groupId}/balances`, {
      headers: { Cookie: cookieA },
    })
    const balBeforeData = (await balBefore.json()) as any[]
    const transfersBefore = balBeforeData[0]?.transfers ?? []

    await proposeSettlement('50.00')

    // Balance unchanged (pending doesn't count)
    const balAfter = await app.request(`/api/fish-pie/groups/${groupId}/balances`, {
      headers: { Cookie: cookieA },
    })
    const balAfterData = (await balAfter.json()) as any[]
    const transfersAfter = balAfterData[0]?.transfers ?? []
    expect(parseFloat(transfersAfter[0]?.amount ?? '0')).toBeCloseTo(
      parseFloat(transfersBefore[0]?.amount ?? '0'),
      1,
    )
  })

  it('GET lists all settlements', async () => {
    await proposeSettlement()

    const listRes = await app.request(`/api/fish-pie/groups/${groupId}/settlements`, {
      headers: { Cookie: cookieA },
    })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as any[]
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('pending')
  })

  describe('confirm', () => {
    let settlementId: string

    beforeEach(async () => {
      const res = await proposeSettlement()
      settlementId = ((await res.json()) as any).id
    })

    it('receiver can confirm and gets a ledger transaction', async () => {
      const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' }, // userA is toUserId
        body: JSON.stringify({ receiverAccountId: accountAId }),
      })
      expect(res.status).toBe(200)
      const s = (await res.json()) as any
      expect(s.status).toBe('completed')
      expect(s.receiverTransactionId).toBeTruthy()

      const postingRows = await db
        .select()
        .from(postings)
        .where(and(eq(postings.transactionId, s.receiverTransactionId), isNull(postings.deletedAt)))
      expect(postingRows).toHaveLength(2)
      const amounts = postingRows.map((p) => parseFloat(p.amount))
      expect(amounts.find((a) => a > 0)).toBeCloseTo(30, 1)  // cash in
      expect(amounts.find((a) => a < 0)).toBeCloseTo(-30, 1) // shared debit
    })

    it('non-receiver cannot confirm', async () => {
      const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookieB, 'Content-Type': 'application/json' }, // userB is fromUserId, not receiver
        body: JSON.stringify({ receiverAccountId: accountBId }),
      })
      expect(res.status).toBe(403)
    })

    it('double confirm returns 409', async () => {
      await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverAccountId: accountAId }),
      })
      const res2 = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverAccountId: accountAId }),
      })
      expect(res2.status).toBe(409)
    })

    it('balance updates after confirmation', async () => {
      await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Dinner', amount: '60.00', currency: 'CAD', date: '2026-04-27', paidByUserId: userAId }),
      })

      const balBefore = await app.request(`/api/fish-pie/groups/${groupId}/balances`, {
        headers: { Cookie: cookieA },
      })
      const before = ((await balBefore.json()) as any[])[0]?.transfers[0]?.amount

      await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverAccountId: accountAId }),
      })

      const balAfter = await app.request(`/api/fish-pie/groups/${groupId}/balances`, {
        headers: { Cookie: cookieA },
      })
      const after = ((await balAfter.json()) as any[])[0]?.transfers[0]?.amount ?? '0'

      // Settling 30 of a 30 debt clears it (or reduces it)
      expect(parseFloat(after)).toBeLessThan(parseFloat(before ?? '999'))
    })

    it('DELETE removes settlement and soft-deletes linked transactions', async () => {
      const confirmRes = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverAccountId: accountAId }),
      })
      const confirmed = (await confirmRes.json()) as any

      const delRes = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlementId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieA },
      })
      expect(delRes.status).toBe(204)

      // Both linked transactions should now be soft-deleted
      for (const txId of [confirmed.payerTransactionId, confirmed.receiverTransactionId]) {
        const txRow = await db.select().from(transactions).where(eq(transactions.id, txId))
        expect(txRow[0].deletedAt).not.toBeNull()
      }
    })
  })

  it('expense + settlement round-trip clears both clearing accounts to zero (BUG-004a)', async () => {
    // A pays $100, 50/50 → B owes A $50
    const expRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-04-27', paymentAccountId: accountAId }),
    })
    expect(expRes.status).toBe(201)

    // B settles $50 to A, A confirms receipt
    const setRes = await proposeSettlement('50.00')
    expect(setRes.status).toBe(201)
    const settlement = (await setRes.json()) as any
    const confRes = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlement.id}/confirm`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverAccountId: accountAId }),
    })
    expect(confRes.status).toBe(200)

    async function clearingBalance(ownerId: string): Promise<number> {
      const [acct] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.userId, ownerId), eq(accounts.path, 'assets:receivable:trip'), isNull(accounts.deletedAt)))
      const ps = await db
        .select({ amount: postings.amount })
        .from(postings)
        .where(and(eq(postings.accountId, acct.id), isNull(postings.deletedAt)))
      return ps.reduce((s, p) => s + parseFloat(p.amount), 0)
    }

    // Payer: +50 receivable at expense time, -50 on confirm → 0
    expect(await clearingBalance(userAId)).toBeCloseTo(0, 2)
    // Debtor: -50 debt at expense time, +50 on settlement → 0
    expect(await clearingBalance(userBId)).toBeCloseTo(0, 2)
  })

  describe('batch settlement', () => {
    // B is always the payer. Sum a transaction's postings per currency.
    async function postingsByCurrency(txId: string): Promise<Record<string, number>> {
      const rows = await db
        .select({ amount: postings.amount, currency: postings.currency })
        .from(postings)
        .where(and(eq(postings.transactionId, txId), isNull(postings.deletedAt)))
      const totals: Record<string, number> = {}
      for (const r of rows) totals[r.currency] = (totals[r.currency] ?? 0) + parseFloat(r.amount)
      return totals
    }

    function batch(body: unknown, cookie = cookieB) {
      return app.request(`/api/fish-pie/groups/${groupId}/settlements/batch`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    it('native-only single line behaves like a plain settlement', async () => {
      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        lines: [{ toUserId: userAId, debtAmount: '30.00', debtCurrency: 'CAD', settledAmount: '30.00', settledCurrency: 'CAD' }],
      })
      expect(res.status).toBe(201)
      const { batchId, settlements } = (await res.json()) as any
      expect(batchId).toBeTruthy()
      expect(settlements).toHaveLength(1)
      const s = settlements[0]
      expect(s.status).toBe('pending')
      expect(s.amount).toBe('30.00')
      expect(s.currency).toBe('CAD')
      // Native ⇒ FX columns stay null.
      expect(s.settledAmount).toBeNull()
      expect(s.settledCurrency).toBeNull()
      expect(s.fxRate).toBeNull()

      // One payer tx, two balanced CAD postings (cash out, clearing in).
      const totals = await postingsByCurrency(s.payerTransactionId)
      expect(totals.CAD).toBeCloseTo(0, 2)
      const rows = await db
        .select()
        .from(postings)
        .where(and(eq(postings.transactionId, s.payerTransactionId), isNull(postings.deletedAt)))
      expect(rows).toHaveLength(2)
    })

    it('converted line bridges currencies and balances per currency', async () => {
      // Owe 50 EUR, pay 80 CAD at 1.60.
      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        lines: [{ toUserId: userAId, debtAmount: '50.00', debtCurrency: 'EUR', settledAmount: '80.00', settledCurrency: 'CAD', fxRate: '1.60' }],
      })
      expect(res.status).toBe(201)
      const { settlements } = (await res.json()) as any
      const s = settlements[0]
      expect(s.currency).toBe('EUR')
      expect(s.amount).toBe('50.00')
      expect(s.settledAmount).toBe('80.00')
      expect(s.settledCurrency).toBe('CAD')
      expect(parseFloat(s.fxRate)).toBeCloseTo(1.6)

      const totals = await postingsByCurrency(s.payerTransactionId)
      expect(totals.CAD).toBeCloseTo(0, 2) // -80 cash + 80 conversion
      expect(totals.EUR).toBeCloseTo(0, 2) // +50 clearing - 50 conversion
      // Cash leg is a single -80 CAD movement out of the payer account.
      const cash = await db
        .select({ amount: postings.amount, currency: postings.currency })
        .from(postings)
        .where(and(eq(postings.transactionId, s.payerTransactionId), eq(postings.accountId, accountBId), isNull(postings.deletedAt)))
      expect(cash).toHaveLength(1)
      expect(parseFloat(cash[0].amount)).toBeCloseTo(-80, 2)
      expect(cash[0].currency).toBe('CAD')
    })

    it('mixed batch produces one combined cash tx and rows sharing batchId', async () => {
      // Owe 500 CAD (native) + 50 EUR→80 CAD. Pay 580 CAD total.
      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        note: 'trip settle',
        lines: [
          { toUserId: userAId, debtAmount: '500.00', debtCurrency: 'CAD', settledAmount: '500.00', settledCurrency: 'CAD' },
          { toUserId: userAId, debtAmount: '50.00', debtCurrency: 'EUR', settledAmount: '80.00', settledCurrency: 'CAD', fxRate: '1.60' },
        ],
      })
      expect(res.status).toBe(201)
      const { batchId, settlements } = (await res.json()) as any
      expect(settlements).toHaveLength(2)
      // All rows share the same batchId and the single payer transaction.
      expect(new Set(settlements.map((x: any) => x.batchId))).toEqual(new Set([batchId]))
      const txIds = new Set(settlements.map((x: any) => x.payerTransactionId))
      expect(txIds.size).toBe(1)
      const txId = settlements[0].payerTransactionId

      const totals = await postingsByCurrency(txId)
      expect(totals.CAD).toBeCloseTo(0, 2)
      expect(totals.EUR).toBeCloseTo(0, 2)
      // Single combined cash movement: -580 CAD.
      const cash = await db
        .select({ amount: postings.amount, currency: postings.currency })
        .from(postings)
        .where(and(eq(postings.transactionId, txId), eq(postings.accountId, accountBId), isNull(postings.deletedAt)))
      expect(cash).toHaveLength(1)
      expect(parseFloat(cash[0].amount)).toBeCloseTo(-580, 2)
    })

    it('a pending batch does not change balances until confirmed', async () => {
      // A pays 100 EUR ⇒ B owes A their EUR share (a real, non-empty balance).
      await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'dinner', amount: '100.00', currency: 'EUR', date: '2026-04-20', paidByUserId: userAId, paymentAccountId: accountAId }),
      })

      const before = (await (await app.request(`/api/fish-pie/groups/${groupId}/balances`, { headers: { Cookie: cookieB } })).json()) as any[]
      const owed = before.find((b) => b.currency === 'EUR').transfers[0]
      expect(owed.fromUserId).toBe(userBId)

      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        lines: [{ toUserId: userAId, debtAmount: owed.amount, debtCurrency: 'EUR', settledAmount: (parseFloat(owed.amount) * 1.6).toFixed(2), settledCurrency: 'CAD', fxRate: '1.60' }],
      })
      expect(res.status).toBe(201)

      const after = await (await app.request(`/api/fish-pie/groups/${groupId}/balances`, { headers: { Cookie: cookieB } })).json()
      // Pending settlement is excluded from balances (only completed ones net).
      expect(after).toEqual(before)
    })

    it('rejects a converted line when the payer has no conversion account', async () => {
      // Null out B's seeded default conversion account.
      await app.request('/api/user-settings', {
        method: 'PATCH',
        headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultConversionAccountId: null }),
      })
      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        lines: [{ toUserId: userAId, debtAmount: '50.00', debtCurrency: 'EUR', settledAmount: '80.00', settledCurrency: 'CAD', fxRate: '1.60' }],
      })
      expect(res.status).toBe(400)
    })

    it('rejects a native line whose settledAmount differs from debtAmount', async () => {
      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        lines: [{ toUserId: userAId, debtAmount: '50.00', debtCurrency: 'CAD', settledAmount: '60.00', settledCurrency: 'CAD' }],
      })
      expect(res.status).toBe(400)
    })

    it('rejects an empty lines array', async () => {
      const res = await batch({ payerAccountId: accountBId, date: '2026-04-28', lines: [] })
      expect(res.status).toBe(400)
    })

    it('rejects settling with yourself', async () => {
      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        lines: [{ toUserId: userBId, debtAmount: '50.00', debtCurrency: 'CAD', settledAmount: '50.00', settledCurrency: 'CAD' }],
      })
      expect(res.status).toBe(400)
    })

    it("rejects a payer account that isn't the caller's", async () => {
      const res = await batch({
        payerAccountId: accountAId, // A's account, but B is calling
        date: '2026-04-28',
        lines: [{ toUserId: userAId, debtAmount: '50.00', debtCurrency: 'CAD', settledAmount: '50.00', settledCurrency: 'CAD' }],
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 for a non-member', async () => {
      const cookieC = await createTestUser('c@test.com', 'passwordC')
      const accC = await app.request('/api/accounts', {
        method: 'POST',
        headers: { Cookie: cookieC, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'assets:chequing' }),
      })
      const accCId = ((await accC.json()) as any).id
      const res = await batch(
        {
          payerAccountId: accCId,
          date: '2026-04-28',
          lines: [{ toUserId: userAId, debtAmount: '50.00', debtCurrency: 'CAD', settledAmount: '50.00', settledCurrency: 'CAD' }],
        },
        cookieC,
      )
      expect(res.status).toBe(404)
    })

    // Create a mixed batch (B pays A: 500 CAD native + 50 EUR→80 CAD) and return it.
    async function mixedBatch() {
      const res = await batch({
        payerAccountId: accountBId,
        date: '2026-04-28',
        lines: [
          { toUserId: userAId, debtAmount: '500.00', debtCurrency: 'CAD', settledAmount: '500.00', settledCurrency: 'CAD' },
          { toUserId: userAId, debtAmount: '50.00', debtCurrency: 'EUR', settledAmount: '80.00', settledCurrency: 'CAD', fxRate: '1.60' },
        ],
      })
      return (await res.json()) as { batchId: string; settlements: any[] }
    }

    function confirmBatch(batchId: string, receiverAccountId: string, cookie = cookieA) {
      return app.request(`/api/fish-pie/groups/${groupId}/settlements/batch/${batchId}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverAccountId }),
      })
    }

    it('receiver confirms a batch into one combined receiving tx and completes all rows', async () => {
      const { batchId } = await mixedBatch()
      const res = await confirmBatch(batchId, accountAId)
      expect(res.status).toBe(200)
      const { settlements } = (await res.json()) as any
      expect(settlements).toHaveLength(2)
      expect(settlements.every((s: any) => s.status === 'completed')).toBe(true)
      // One shared receiver transaction.
      const rxIds = new Set(settlements.map((s: any) => s.receiverTransactionId))
      expect(rxIds.size).toBe(1)
      const rxId = settlements[0].receiverTransactionId

      const totals = await postingsByCurrency(rxId)
      expect(totals.CAD).toBeCloseTo(0, 2)
      expect(totals.EUR).toBeCloseTo(0, 2)
      // Single combined cash-in: +580 CAD into the receiver's account.
      const cash = await db
        .select({ amount: postings.amount, currency: postings.currency })
        .from(postings)
        .where(and(eq(postings.transactionId, rxId), eq(postings.accountId, accountAId), isNull(postings.deletedAt)))
      expect(cash).toHaveLength(1)
      expect(parseFloat(cash[0].amount)).toBeCloseTo(580, 2)
      expect(cash[0].currency).toBe('CAD')
    })

    it('only the receiver can confirm — the payer gets 404', async () => {
      const { batchId } = await mixedBatch()
      // B is the payer; no rows in the batch are addressed to B.
      const res = await confirmBatch(batchId, accountBId, cookieB)
      expect(res.status).toBe(404)
    })

    it('confirming an already-confirmed batch returns 409', async () => {
      const { batchId } = await mixedBatch()
      expect((await confirmBatch(batchId, accountAId)).status).toBe(200)
      const again = await confirmBatch(batchId, accountAId)
      expect(again.status).toBe(409)
    })

    it('the single confirm endpoint rejects a batch row', async () => {
      const { settlements } = await mixedBatch()
      const res = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlements[0].id}/confirm`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverAccountId: accountAId }),
      })
      expect(res.status).toBe(409)
    })

    it('balances reflect completion after a cross-currency confirm', async () => {
      // A pays 100 EUR ⇒ B owes A their share. Read the exact owed amount rather
      // than assume the split, then settle that and confirm.
      await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'dinner', amount: '100.00', currency: 'EUR', date: '2026-04-20', paidByUserId: userAId, paymentAccountId: accountAId }),
      })

      const beforeBalances = (await (
        await app.request(`/api/fish-pie/groups/${groupId}/balances`, { headers: { Cookie: cookieB } })
      ).json()) as any[]
      const owed = beforeBalances.find((b) => b.currency === 'EUR').transfers[0]
      expect(owed.fromUserId).toBe(userBId)
      const owedAmount = owed.amount
      const settledCad = (parseFloat(owedAmount) * 1.6).toFixed(2)

      const { batchId } = (await (
        await batch({
          payerAccountId: accountBId,
          date: '2026-04-28',
          lines: [{ toUserId: userAId, debtAmount: owedAmount, debtCurrency: 'EUR', settledAmount: settledCad, settledCurrency: 'CAD', fxRate: '1.60' }],
        })
      ).json()) as any

      expect((await confirmBatch(batchId, accountAId)).status).toBe(200)

      const balances = (await (
        await app.request(`/api/fish-pie/groups/${groupId}/balances`, { headers: { Cookie: cookieB } })
      ).json()) as any[]
      // EUR debt is settled, so it nets zero — no outstanding EUR transfers remain.
      const eur = balances.find((b) => b.currency === 'EUR')
      expect(eur?.transfers ?? []).toHaveLength(0)
    })

    it('deleting a batch soft-deletes every row, the payer tx, and the receiver tx', async () => {
      const { batchId, settlements } = await mixedBatch()
      const payerTxId = settlements[0].payerTransactionId
      await confirmBatch(batchId, accountAId)
      const [confirmed] = await db.select().from(groupSettlements).where(eq(groupSettlements.id, settlements[0].id))
      const receiverTxId = confirmed.receiverTransactionId!

      // Delete via a single row id — cascades to the whole batch.
      const del = await app.request(`/api/fish-pie/groups/${groupId}/settlements/${settlements[1].id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieB },
      })
      expect(del.status).toBe(204)

      // All rows soft-deleted.
      const rows = await db
        .select()
        .from(groupSettlements)
        .where(and(eq(groupSettlements.batchId, batchId), isNull(groupSettlements.deletedAt)))
      expect(rows).toHaveLength(0)

      // Both transactions + their postings soft-deleted.
      for (const txId of [payerTxId, receiverTxId]) {
        const [txRow] = await db.select().from(transactions).where(eq(transactions.id, txId))
        expect(txRow.deletedAt).not.toBeNull()
        const livePostings = await db
          .select()
          .from(postings)
          .where(and(eq(postings.transactionId, txId), isNull(postings.deletedAt)))
        expect(livePostings).toHaveLength(0)
      }

      // GET no longer lists the batch.
      const list = (await (await app.request(`/api/fish-pie/groups/${groupId}/settlements`, { headers: { Cookie: cookieB } })).json()) as any[]
      expect(list.filter((s) => s.batchId === batchId)).toHaveLength(0)
    })
  })
})
