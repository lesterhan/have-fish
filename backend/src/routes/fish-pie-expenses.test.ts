import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { transactions, postings, accounts, expenseGroupMembers, groupExpenses, groupExpenseSplits } from '../db/schema'
import { eq, isNull, and, inArray } from 'drizzle-orm'

describe('fish-pie expenses', () => {
  let cookie: string
  let groupId: string
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()

    // Get user id from session
    const sessionRes = await app.request('/api/auth/get-session', {
      headers: { Cookie: cookie },
    })
    userId = (await sessionRes.json() as any).user.id

    const res = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip' }),
    })
    groupId = (await res.json() as any).id
  })

  it('POST creates expense and splits sum to expense amount', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '90.00', currency: 'CAD', date: '2026-04-28' }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any
    expect(expense.description).toBe('Dinner')
    expect(expense.splits).toHaveLength(1)
    const splitTotal = expense.splits.reduce((s: number, sp: any) => s + parseFloat(sp.amount), 0)
    expect(splitTotal.toFixed(2)).toBe('90.00')
  })

  it('POST auto-posts to uncategorized + shared accounts when no default set', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Groceries', amount: '50.00', currency: 'CAD', date: '2026-05-01' }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any

    // One transaction created for the sole member
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expense.id))
    expect(txs).toHaveLength(1)
    expect(txs[0].userId).toBe(userId)

    // Two postings: debit uncategorized, credit shared
    const ps = await db.select().from(postings).where(eq(postings.transactionId, txs[0].id))
    expect(ps).toHaveLength(2)

    const debit = ps.find((p) => parseFloat(p.amount) < 0)!
    const credit = ps.find((p) => parseFloat(p.amount) > 0)!
    expect(debit).toBeDefined()
    expect(credit).toBeDefined()
    expect(Math.abs(parseFloat(debit.amount))).toBe(50)
    expect(parseFloat(credit.amount)).toBe(50)

    // Accounts exist
    const uncategorized = await db.select().from(accounts).where(and(eq(accounts.id, debit.accountId), isNull(accounts.deletedAt)))
    expect(uncategorized[0].path).toBe('uncategorized')

    const shared = await db.select().from(accounts).where(and(eq(accounts.id, credit.accountId), isNull(accounts.deletedAt)))
    expect(shared[0].path).toMatch(/^group:/)
  })

  it('POST auto-posts to configured defaultExpenseAccountId', async () => {
    // Create an expense account
    const acctRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'expenses:food', name: 'Food' }),
    })
    const acct = await acctRes.json() as any

    // Set it as the default expense account for the group
    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: acct.id }),
    })
    expect(patchRes.status).toBe(200)

    // Add expense
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Sushi', amount: '80.00', currency: 'JPY', date: '2026-05-10' }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any

    const txs = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    const ps = await db.select().from(postings).where(eq(postings.transactionId, txs[0].id))

    const debit = ps.find((p) => parseFloat(p.amount) < 0)!
    // Should use the configured account, not uncategorized
    expect(debit.accountId).toBe(acct.id)
  })

  it('POST with two members creates two transactions', async () => {
    // Create second user and invite them
    const cookie2 = await createTestUser('partner@example.com')
    await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner@example.com' }),
    })
    const invitesRes = await app.request('/api/fish-pie/invites', {
      headers: { Cookie: cookie2 },
    })
    const [invite] = await invitesRes.json() as any[]
    await app.request(`/api/fish-pie/invites/${invite.id}/accept`, {
      method: 'POST',
      headers: { Cookie: cookie2 },
    })

    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Hotel', amount: '200.00', currency: 'USD', date: '2026-06-01' }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any

    // Two transactions, one per member
    const txs = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    expect(txs).toHaveLength(2)

    // Each has 2 postings (debit + credit)
    for (const tx of txs) {
      const ps = await db.select().from(postings).where(eq(postings.transactionId, tx.id))
      expect(ps).toHaveLength(2)
      const debit = ps.find((p) => parseFloat(p.amount) < 0)!
      const credit = ps.find((p) => parseFloat(p.amount) > 0)!
      expect(Math.abs(parseFloat(debit.amount))).toBeCloseTo(100, 2)
      expect(parseFloat(credit.amount)).toBeCloseTo(100, 2)
    }
  })

  it('DELETE soft-deletes group expense and all linked transactions + postings', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Taxi', amount: '30.00', currency: 'CAD', date: '2026-05-15' }),
    })
    const expense = await createRes.json() as any

    // Verify transactions exist before delete
    const txsBefore = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    expect(txsBefore).toHaveLength(1)

    const deleteRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(deleteRes.status).toBe(204)

    // Transactions soft-deleted
    const txsAfter = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    expect(txsAfter).toHaveLength(1)
    expect(txsAfter[0].deletedAt).not.toBeNull()

    // Postings soft-deleted
    const ps = await db
      .select()
      .from(postings)
      .where(eq(postings.transactionId, txsAfter[0].id))
    expect(ps.every((p) => p.deletedAt !== null)).toBe(true)
  })

  it('DELETE /api/fish-pie/group-expenses/:id removes from group via convenience endpoint', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Train', amount: '20.00', currency: 'CAD', date: '2026-05-20' }),
    })
    const expense = await createRes.json() as any

    const res = await app.request(`/api/fish-pie/group-expenses/${expense.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(204)

    const txs = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    expect(txs[0].deletedAt).not.toBeNull()
  })

  it('DELETE /api/fish-pie/group-expenses/:id returns 403 for non-payer', async () => {
    const cookie2 = await createTestUser('other@example.com')

    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Bus', amount: '10.00', currency: 'CAD', date: '2026-05-22' }),
    })
    const expense = await createRes.json() as any

    const res = await app.request(`/api/fish-pie/group-expenses/${expense.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie2 },
    })
    expect(res.status).toBe(403)
  })
})

describe('fish-pie group members/me', () => {
  let cookie: string
  let groupId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    const res = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Housing' }),
    })
    groupId = (await res.json() as any).id
  })

  it('PATCH /members/me sets defaultExpenseAccountId', async () => {
    const acctRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'expenses:housing', name: 'Housing' }),
    })
    const acct = await acctRes.json() as any

    const res = await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: acct.id }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json() as any
    expect(updated.defaultExpenseAccountId).toBe(acct.id)
  })

  it('PATCH /members/me clears defaultExpenseAccountId when null', async () => {
    const acctRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'expenses:housing' }),
    })
    const acct = await acctRes.json() as any

    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: acct.id }),
    })

    const res = await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: null }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json() as any
    expect(updated.defaultExpenseAccountId).toBeNull()
  })

  it('PATCH /members/me rejects account belonging to another user', async () => {
    const cookie2 = await createTestUser('other@example.com')
    const otherAcctRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'expenses:food' }),
    })
    const otherAcct = await otherAcctRes.json() as any

    const res = await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: otherAcct.id }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /members/me returns 404 for non-member', async () => {
    const cookie2 = await createTestUser('nonmember@example.com')
    const res = await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: null }),
    })
    expect(res.status).toBe(404)
  })

  it('member defaultExpenseAccountId included in group response', async () => {
    const acctRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'expenses:food' }),
    })
    const acct = await acctRes.json() as any

    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: acct.id }),
    })

    const groupRes = await app.request(`/api/fish-pie/groups/${groupId}`, {
      headers: { Cookie: cookie },
    })
    const group = await groupRes.json() as any
    expect(group.members[0].defaultExpenseAccountId).toBe(acct.id)
  })
})

describe('fish-pie shared account auto-creation', () => {
  let cookie: string
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    const sessionRes = await app.request('/api/auth/get-session', {
      headers: { Cookie: cookie },
    })
    userId = (await sessionRes.json() as any).user.id
  })

  it('creating a group auto-creates shared account for creator', async () => {
    const res = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Food Group' }),
    })
    expect(res.status).toBe(201)

    const sharedAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    const shared = sharedAccounts.find((a) => a.path.startsWith('group:'))
    expect(shared).toBeDefined()
    expect(shared!.path).toBe('group:food-group')
  })

  it('accepting invite auto-creates shared account for new member', async () => {
    const cookie2 = await createTestUser('member@example.com')
    const sessionRes2 = await app.request('/api/auth/get-session', { headers: { Cookie: cookie2 } })
    const userId2 = (await sessionRes2.json() as any).user.id

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Housing' }),
    })
    const groupId = (await groupRes.json() as any).id

    await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com' }),
    })

    const invitesRes = await app.request('/api/fish-pie/invites', { headers: { Cookie: cookie2 } })
    const [invite] = await invitesRes.json() as any[]
    await app.request(`/api/fish-pie/invites/${invite.id}/accept`, {
      method: 'POST',
      headers: { Cookie: cookie2 },
    })

    const accts = await db.select().from(accounts).where(and(eq(accounts.userId, userId2), isNull(accounts.deletedAt)))
    const shared = accts.find((a) => a.path.startsWith('group:'))
    expect(shared).toBeDefined()
    expect(shared!.path).toBe('group:housing')
  })
})

describe('fish-pie delete import-linked expense', () => {
  let cookieA: string
  let cookieB: string
  let groupId: string
  let sourceId: string

  beforeEach(async () => {
    await clearDatabase()
    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Food' }),
    })
    groupId = (await groupRes.json() as any).id

    const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@test.com' }),
    })
    const inviteId = (await invRes.json() as any).id
    await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: { Cookie: cookieB },
    })

    const srcRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa', name: 'Visa' }),
    })
    sourceId = (await srcRes.json() as any).id
  })

  it('DELETE also soft-deletes the import transaction linked via groupExpenses.transactionId', async () => {
    // Import a row with Fish Pie group split
    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [{
          isTransfer: false,
          date: new Date('2026-05-01').toISOString(),
          description: 'Tim Hortons',
          amount: '10.00',
          sourceAccountId: sourceId,
        }],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    const [expense] = await db
      .select()
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))

    expect(expense).toBeTruthy()
    expect(expense.transactionId).toBeTruthy()
    const importTxId = expense.transactionId!

    // Delete the group expense
    const res = await app.request(`/api/fish-pie/group-expenses/${expense.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    })
    expect(res.status).toBe(204)

    // Import transaction must be soft-deleted
    const [importTx] = await db.select().from(transactions).where(eq(transactions.id, importTxId))
    expect(importTx.deletedAt).not.toBeNull()

    // Its postings must also be soft-deleted
    const importPostings = await db.select().from(postings).where(eq(postings.transactionId, importTxId))
    expect(importPostings.every((p) => p.deletedAt !== null)).toBe(true)

    // Member transactions must also be soft-deleted
    const memberTxs = await db
      .select()
      .from(transactions)
      .where(inArray(transactions.id,
        (await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.groupExpenseId, expense.id)))
          .map((t) => t.id)
      ))
    expect(memberTxs.every((t) => t.deletedAt !== null)).toBe(true)
  })
})

describe('fish-pie PATCH expense', () => {
  let cookieA: string
  let cookieB: string
  let groupId: string
  let userId: string

  beforeEach(async () => {
    await clearDatabase()
    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')

    const sessionRes = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    userId = (await sessionRes.json() as any).user.id

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip' }),
    })
    groupId = (await groupRes.json() as any).id

    const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@test.com' }),
    })
    const inviteId = (await invRes.json() as any).id
    await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: { Cookie: cookieB },
    })
  })

  it('PATCH updates description, amount, and date; recomputes postings', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-05-01' }),
    })
    const expense = await createRes.json() as any

    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner edited', amount: '80.00', date: '2026-05-02' }),
    })
    expect(patchRes.status).toBe(200)
    const updated = await patchRes.json() as any
    expect(updated.description).toBe('Dinner edited')
    expect(parseFloat(updated.amount)).toBeCloseTo(80, 2)
    expect(updated.date).toBe('2026-05-02')

    // Old member transactions soft-deleted, new ones created with new amount
    const allTxs = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    const activeTxs = allTxs.filter((t) => t.deletedAt === null)
    expect(activeTxs).toHaveLength(2)  // one per member

    for (const tx of activeTxs) {
      const ps = await db.select().from(postings).where(and(eq(postings.transactionId, tx.id), isNull(postings.deletedAt)))
      expect(ps).toHaveLength(2)
      const debit = ps.find((p) => parseFloat(p.amount) < 0)!
      expect(Math.abs(parseFloat(debit.amount))).toBeCloseTo(40, 2)  // 80 / 2 members
    }
  })

  it('PATCH with split weights recomputes amounts per weight', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Hotel', amount: '100.00', currency: 'CAD', date: '2026-06-01' }),
    })
    const expense = await createRes.json() as any

    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    const userIdB = (await sessionB.json() as any).user.id

    // Edit with 70/30 split (userA gets 70, userB gets 30)
    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: [
          { userId, shareWeight: 70 },
          { userId: userIdB, shareWeight: 30 },
        ],
      }),
    })
    expect(patchRes.status).toBe(200)
    const updated = await patchRes.json() as any

    const splitA = updated.splits.find((s: any) => s.userId === userId)
    const splitB = updated.splits.find((s: any) => s.userId === userIdB)
    expect(parseFloat(splitA.amount)).toBeCloseTo(70, 2)
    expect(parseFloat(splitB.amount)).toBeCloseTo(30, 2)
  })

  it('PATCH with new payer creates correct member transactions', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Taxi', amount: '60.00', currency: 'CAD', date: '2026-06-10' }),
    })
    const expense = await createRes.json() as any
    expect(expense.paidByUserId).toBe(userId)

    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    const userIdB = (await sessionB.json() as any).user.id

    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidByUserId: userIdB }),
    })
    expect(patchRes.status).toBe(200)
    const updated = await patchRes.json() as any
    expect(updated.paidByUserId).toBe(userIdB)

    // Both members still have active member transactions
    const activeTxs = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.groupExpenseId, expense.id), isNull(transactions.deletedAt)))
    expect(activeTxs).toHaveLength(2)
    const txUserIds = activeTxs.map((t) => t.userId).sort()
    expect(txUserIds).toContain(userId)
    expect(txUserIds).toContain(userIdB)
  })

  it('PATCH returns 403 for non-payer non-creator', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Lunch', amount: '20.00', currency: 'CAD', date: '2026-06-01' }),
    })
    const expense = await createRes.json() as any

    // cookieB is a member but not the payer and not the creator
    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Edited' }),
    })
    expect(patchRes.status).toBe(403)
  })

  it('PATCH returns 400 for invalid amount', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Snack', amount: '5.00', currency: 'CAD', date: '2026-06-01' }),
    })
    const expense = await createRes.json() as any

    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '-10.00' }),
    })
    expect(patchRes.status).toBe(400)
  })

  it('PATCH import-linked expense updates import tx split postings, does not delete import tx', async () => {
    // Create source account and import a row with fish pie split
    const srcRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa' }),
    })
    const sourceId = (await srcRes.json() as any).id

    await app.request('/api/import/commit', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: sourceId,
        defaultCurrency: 'CAD',
        transactions: [{
          isTransfer: false,
          date: new Date('2026-05-01').toISOString(),
          description: 'Restaurant',
          amount: '100.00',
          sourceAccountId: sourceId,
        }],
        groupSplits: [{ rowIndex: 0, groupId }],
      }),
    })

    const [expense] = await db
      .select()
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))

    expect(expense.transactionId).toBeTruthy()
    const importTxId = expense.transactionId!

    // Count original postings on import tx
    const originalImportPostings = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, importTxId), isNull(postings.deletedAt)))
    expect(originalImportPostings).toHaveLength(3)  // standard 3-posting

    // Edit the split to 70/30
    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    const userIdB = (await sessionB.json() as any).user.id

    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: [
          { userId, shareWeight: 70 },
          { userId: userIdB, shareWeight: 30 },
        ],
      }),
    })
    expect(patchRes.status).toBe(200)

    // Import transaction NOT deleted
    const [importTx] = await db.select().from(transactions).where(eq(transactions.id, importTxId))
    expect(importTx.deletedAt).toBeNull()

    // Active postings on import tx: source posting unchanged + new group + new expense = 3 active
    const activeImportPostings = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, importTxId), isNull(postings.deletedAt)))
    expect(activeImportPostings).toHaveLength(3)

    // Verify postings still balance (sum to zero)
    const sum = activeImportPostings.reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(Math.abs(sum)).toBeLessThan(0.01)
  })
})
