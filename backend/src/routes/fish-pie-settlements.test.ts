import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { transactions, postings, accounts } from '../db/schema'
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
        .where(and(eq(accounts.userId, ownerId), eq(accounts.path, 'group:trip'), isNull(accounts.deletedAt)))
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
})
