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
  let paymentAccountId: string

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

    const acctRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa', name: 'Visa' }),
    })
    paymentAccountId = (await acctRes.json() as any).id
  })

  it('POST creates expense and splits sum to expense amount', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '90.00', currency: 'CAD', date: '2026-04-28', paymentAccountId }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any
    expect(expense.description).toBe('Dinner')
    expect(expense.splits).toHaveLength(1)
    const splitTotal = expense.splits.reduce((s: number, sp: any) => s + parseFloat(sp.amount), 0)
    expect(splitTotal.toFixed(2)).toBe('90.00')
  })

  it('POST creates payment debit and expense credit postings (no default expense account)', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Groceries', amount: '50.00', currency: 'CAD', date: '2026-05-01', paymentAccountId }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any

    // One transaction for the sole member
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expense.id))
    expect(txs).toHaveLength(1)
    expect(txs[0].userId).toBe(userId)

    // 1-member group: 2 postings (payment debit + expense credit; no shared posting since zero)
    const ps = await db.select().from(postings).where(eq(postings.transactionId, txs[0].id))
    expect(ps).toHaveLength(2)

    const debit = ps.find((p) => parseFloat(p.amount) < 0)!
    const credit = ps.find((p) => parseFloat(p.amount) > 0)!
    expect(debit).toBeDefined()
    expect(credit).toBeDefined()
    expect(Math.abs(parseFloat(debit.amount))).toBe(50)
    expect(parseFloat(credit.amount)).toBe(50)

    // Debit is the payment account
    expect(debit.accountId).toBe(paymentAccountId)

    // Credit is the expense account (uncategorized since no default set)
    const expenseAcct = await db.select().from(accounts).where(and(eq(accounts.id, credit.accountId), isNull(accounts.deletedAt)))
    expect(expenseAcct[0].path).toBe('uncategorized')
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
      body: JSON.stringify({ description: 'Sushi', amount: '80.00', currency: 'JPY', date: '2026-05-10', paymentAccountId }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any

    const txs = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    const ps = await db.select().from(postings).where(eq(postings.transactionId, txs[0].id))

    // Debit is the payment account; credit is the configured expense account
    const debit = ps.find((p) => parseFloat(p.amount) < 0)!
    expect(debit.accountId).toBe(paymentAccountId)
    const credit = ps.find((p) => parseFloat(p.amount) > 0)!
    expect(credit.accountId).toBe(acct.id)
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
      body: JSON.stringify({ description: 'Hotel', amount: '200.00', currency: 'USD', date: '2026-06-01', paymentAccountId }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any

    // Two transactions, one per member
    const txs = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    expect(txs).toHaveLength(2)

    const payerTx = txs.find((t) => t.userId === userId)!
    const nonPayerTx = txs.find((t) => t.userId !== userId)!

    // Payer gets 3 postings: payment(-200), shared(+100), expense(+100)
    const payerPs = await db.select().from(postings).where(eq(postings.transactionId, payerTx.id))
    expect(payerPs).toHaveLength(3)
    const payerDebit = payerPs.find((p) => parseFloat(p.amount) < 0)!
    expect(Math.abs(parseFloat(payerDebit.amount))).toBeCloseTo(200, 2)
    expect(payerDebit.accountId).toBe(paymentAccountId)
    const payerCredits = payerPs.filter((p) => parseFloat(p.amount) > 0)
    expect(payerCredits.reduce((s, p) => s + parseFloat(p.amount), 0)).toBeCloseTo(200, 2)

    // Non-payer gets 2 postings: expense +100 (their share of spending), shared -100 (their debt)
    const nonPayerPs = await db.select().from(postings).where(eq(postings.transactionId, nonPayerTx.id))
    expect(nonPayerPs).toHaveLength(2)
    const nonPayerAccts = await db.select().from(accounts).where(inArray(accounts.id, nonPayerPs.map((p) => p.accountId)))
    const sharedAcct = nonPayerAccts.find((a) => a.path.startsWith('group:'))!
    const sharedPosting = nonPayerPs.find((p) => p.accountId === sharedAcct.id)!
    const expensePosting = nonPayerPs.find((p) => p.accountId !== sharedAcct.id)!
    expect(parseFloat(expensePosting.amount)).toBeCloseTo(100, 2)
    expect(parseFloat(sharedPosting.amount)).toBeCloseTo(-100, 2)
  })

  it('DELETE soft-deletes group expense and all linked transactions + postings', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Taxi', amount: '30.00', currency: 'CAD', date: '2026-05-15', paymentAccountId }),
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
      body: JSON.stringify({ description: 'Train', amount: '20.00', currency: 'CAD', date: '2026-05-20', paymentAccountId }),
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
      body: JSON.stringify({ description: 'Bus', amount: '10.00', currency: 'CAD', date: '2026-05-22', paymentAccountId }),
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
  let paymentAccountId: string

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

    const srcRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa', name: 'Visa' }),
    })
    paymentAccountId = (await srcRes.json() as any).id
  })

  it('PATCH updates description, amount, and date; recomputes postings', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-05-01', paymentAccountId }),
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
      body: JSON.stringify({ description: 'Hotel', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
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
      body: JSON.stringify({ description: 'Taxi', amount: '60.00', currency: 'CAD', date: '2026-06-10', paymentAccountId }),
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
      body: JSON.stringify({ description: 'Lunch', amount: '20.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
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
      body: JSON.stringify({ description: 'Snack', amount: '5.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
    })
    const expense = await createRes.json() as any

    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: '-10.00' }),
    })
    expect(patchRes.status).toBe(400)
  })

  it('PATCH updates to 3-posting payer tx when paymentAccountId provided', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
    })
    const expense = await createRes.json() as any

    // Create a second payment account to patch with
    const acct2Res = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:mastercard', name: 'Mastercard' }),
    })
    const paymentAccountId2 = (await acct2Res.json() as any).id

    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentAccountId: paymentAccountId2 }),
    })
    expect(patchRes.status).toBe(200)

    const activeTxs = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.groupExpenseId, expense.id), isNull(transactions.deletedAt)))
    const payerTx = activeTxs.find((t) => t.userId === userId)!

    // Payer tx should now debit the new payment account
    const ps = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, payerTx.id), isNull(postings.deletedAt)))
    const debit = ps.find((p) => parseFloat(p.amount) < 0)!
    expect(debit.accountId).toBe(paymentAccountId2)
  })

  it('PATCH returns 400 when paymentAccountId belongs to another user', async () => {
    const createRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '50.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
    })
    const expense = await createRes.json() as any

    // Create an account belonging to B
    const acctBRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa' }),
    })
    const acctBId = (await acctBRes.json() as any).id

    const patchRes = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentAccountId: acctBId }),
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

describe('fish-pie Story 3 — paymentAccountId required, 3-posting payer tx, defaultPaymentAccountId auto-save', () => {
  let cookieA: string
  let cookieB: string
  let groupId: string
  let userId: string
  let userIdB: string
  let paymentAccountId: string

  beforeEach(async () => {
    await clearDatabase()
    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')

    const sessionA = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    userId = (await sessionA.json() as any).user.id
    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    userIdB = (await sessionB.json() as any).user.id

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

    const srcRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa', name: 'Visa' }),
    })
    paymentAccountId = (await srcRes.json() as any).id
  })

  it('POST returns 400 when paymentAccountId is missing', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-06-01' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toMatch(/paymentAccountId/)
  })

  it('POST returns 400 when paymentAccountId belongs to another user', async () => {
    // Create account belonging to B, try to use it when A is payer
    const acctBRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'liabilities:visa' }),
    })
    const acctBId = (await acctBRes.json() as any).id

    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId: acctBId }),
    })
    expect(res.status).toBe(400)
  })

  it('POST with paymentAccountId creates 3-posting payer tx and 2-posting non-payer tx', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
    })
    expect(res.status).toBe(201)
    const expense = await res.json() as any

    const allTxs = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
    const payerTx = allTxs.find((t) => t.userId === userId)!
    const nonPayerTx = allTxs.find((t) => t.userId === userIdB)!

    // Payer tx: 3 postings (payment -100, shared +50, expense +50)
    const payerPs = await db.select().from(postings).where(eq(postings.transactionId, payerTx.id))
    expect(payerPs).toHaveLength(3)

    const payerDebit = payerPs.find((p) => parseFloat(p.amount) < 0)!
    expect(payerDebit.accountId).toBe(paymentAccountId)
    expect(parseFloat(payerDebit.amount)).toBeCloseTo(-100, 2)

    const payerCreditsSum = payerPs.filter((p) => parseFloat(p.amount) > 0).reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(payerCreditsSum).toBeCloseTo(100, 2)

    // Postings balance: sum = 0
    const payerSum = payerPs.reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(Math.abs(payerSum)).toBeLessThan(0.01)

    // Non-payer tx: 2 postings (expense +50, shared -50) — see BUG-005
    const nonPayerPs = await db.select().from(postings).where(eq(postings.transactionId, nonPayerTx.id))
    expect(nonPayerPs).toHaveLength(2)
    const nonPayerAccts = await db.select().from(accounts).where(inArray(accounts.id, nonPayerPs.map((p) => p.accountId)))
    const sharedAcct = nonPayerAccts.find((a) => a.path.startsWith('group:'))!
    const sharedPosting = nonPayerPs.find((p) => p.accountId === sharedAcct.id)!
    const expensePosting = nonPayerPs.find((p) => p.accountId !== sharedAcct.id)!
    expect(parseFloat(expensePosting.amount)).toBeCloseTo(50, 2)
    expect(parseFloat(sharedPosting.amount)).toBeCloseTo(-50, 2)
    const nonPayerSum = nonPayerPs.reduce((s, p) => s + parseFloat(p.amount), 0)
    expect(Math.abs(nonPayerSum)).toBeLessThan(0.01)
  })

  it('POST auto-saves defaultPaymentAccountId on payer member row', async () => {
    // Verify defaultPaymentAccountId starts null
    const groupBefore = await app.request(`/api/fish-pie/groups/${groupId}`, { headers: { Cookie: cookieA } })
    const memberBefore = (await groupBefore.json() as any).members.find((m: any) => m.userId === userId)
    expect(memberBefore.defaultPaymentAccountId).toBeNull()

    await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
    })

    const groupAfter = await app.request(`/api/fish-pie/groups/${groupId}`, { headers: { Cookie: cookieA } })
    const memberAfter = (await groupAfter.json() as any).members.find((m: any) => m.userId === userId)
    expect(memberAfter.defaultPaymentAccountId).toBe(paymentAccountId)
  })

  it('POST does not overwrite defaultPaymentAccountId when it matches', async () => {
    // Pre-set defaultPaymentAccountId
    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultPaymentAccountId: paymentAccountId }),
    })

    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Coffee', amount: '10.00', currency: 'CAD', date: '2026-06-02', paymentAccountId }),
    })
    expect(res.status).toBe(201)

    const groupRes = await app.request(`/api/fish-pie/groups/${groupId}`, { headers: { Cookie: cookieA } })
    const member = (await groupRes.json() as any).members.find((m: any) => m.userId === userId)
    expect(member.defaultPaymentAccountId).toBe(paymentAccountId)
  })

  it('PATCH /members/me sets and returns defaultPaymentAccountId', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultPaymentAccountId: paymentAccountId }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json() as any
    expect(updated.defaultPaymentAccountId).toBe(paymentAccountId)
  })

  it('PATCH /members/me clears defaultPaymentAccountId when null', async () => {
    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultPaymentAccountId: paymentAccountId }),
    })

    const res = await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultPaymentAccountId: null }),
    })
    expect(res.status).toBe(200)
    const updated = await res.json() as any
    expect(updated.defaultPaymentAccountId).toBeNull()
  })
})

describe('fish-pie BUG-005 — non-payer posting signs', () => {
  let cookieA: string
  let cookieB: string
  let groupId: string
  let userId: string
  let userIdB: string
  let paymentAccountId: string
  let foodAccountBId: string

  beforeEach(async () => {
    await clearDatabase()
    cookieA = await createTestUser('a@test.com', 'passwordA')
    cookieB = await createTestUser('b@test.com', 'passwordB')

    const sessionA = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    userId = (await sessionA.json() as any).user.id
    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    userIdB = (await sessionB.json() as any).user.id

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Household' }),
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
    paymentAccountId = (await srcRes.json() as any).id

    // B routes their group shares to expenses:food
    const foodRes = await app.request('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'expenses:food', name: 'Food' }),
    })
    foodAccountBId = (await foodRes.json() as any).id
    await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
      method: 'PATCH',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultExpenseAccountId: foodAccountBId }),
    })
  })

  it('non-payer share counts positively in their spending summary', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
    })
    expect(res.status).toBe(201)

    const sumRes = await app.request('/api/reports/spending-summary?from=2026-06-01&to=2026-06-30', {
      headers: { Cookie: cookieB },
    })
    expect(sumRes.status).toBe(200)
    const summary = await sumRes.json() as any
    expect(summary.total.CAD).toBe('50.00')
    const food = summary.categories.find((cat: any) => cat.category === 'expenses:food')
    expect(food.total.CAD).toBe('50.00')
  })

  it('clearing accounts carry +others share for the payer and -share for the non-payer', async () => {
    const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-06-01', paymentAccountId }),
    })
    expect(res.status).toBe(201)

    async function clearingBalance(ownerId: string): Promise<number> {
      const [acct] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.userId, ownerId), eq(accounts.path, 'group:household'), isNull(accounts.deletedAt)))
      const ps = await db
        .select({ amount: postings.amount })
        .from(postings)
        .where(and(eq(postings.accountId, acct.id), isNull(postings.deletedAt)))
      return ps.reduce((s, p) => s + parseFloat(p.amount), 0)
    }

    expect(await clearingBalance(userId)).toBeCloseTo(50, 2)   // payer is owed B's share
    expect(await clearingBalance(userIdB)).toBeCloseTo(-50, 2) // B owes their share
  })
})
