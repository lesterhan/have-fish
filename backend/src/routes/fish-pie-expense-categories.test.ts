import { describe, it, expect, beforeEach } from 'bun:test'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { transactions, postings, accounts, groupExpenses } from '../db/schema'
import { eq, isNull, and } from 'drizzle-orm'

// Exercises story 2: categoryId on expenses — account resolution, weight resolution,
// import with/without category, and PATCH recategorization.

async function getUserId(cookie: string): Promise<string> {
  const res = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } })
  return ((await res.json()) as any).user.id
}

async function createGroup(cookie: string, name = 'Household'): Promise<string> {
  const res = await app.request('/api/fish-pie/groups', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as any).id
}

async function createAccount(cookie: string, path: string): Promise<string> {
  const res = await app.request('/api/accounts', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name: path }),
  })
  return ((await res.json()) as any).id
}

async function createCategory(groupId: string, cookie: string, name: string): Promise<string> {
  const res = await app.request(`/api/fish-pie/groups/${groupId}/categories`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as any).id
}

function setMapping(groupId: string, categoryId: string, cookie: string, body: Record<string, unknown>) {
  return app.request(`/api/fish-pie/groups/${groupId}/categories/${categoryId}/my-mapping`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function inviteAndAccept(groupId: string, ownerCookie: string, email: string, memberCookie: string) {
  const invRes = await app.request(`/api/fish-pie/groups/${groupId}/invites`, {
    method: 'POST',
    headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const inviteId = ((await invRes.json()) as any).id
  await app.request(`/api/fish-pie/invites/${inviteId}/accept`, {
    method: 'POST',
    headers: { Cookie: memberCookie },
  })
}

function createExpense(groupId: string, cookie: string, body: Record<string, unknown>) {
  return app.request(`/api/fish-pie/groups/${groupId}/expenses`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function accountPath(id: string): Promise<string> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, id))
  return a.path
}

describe('fish-pie expense categories', () => {
  let cookie: string
  let groupId: string
  let userId: string
  let paymentAccountId: string

  beforeEach(async () => {
    await clearDatabase()
    cookie = await createTestUser()
    userId = await getUserId(cookie)
    groupId = await createGroup(cookie)
    paymentAccountId = await createAccount(cookie, 'liabilities:visa')
  })

  describe('category validation', () => {
    it('POST rejects a category from another group', async () => {
      const otherGroup = await createGroup(cookie, 'Other')
      const foreignCat = await createCategory(otherGroup, cookie, 'Food')
      const res = await createExpense(groupId, cookie, {
        description: 'Dinner', amount: '40.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: foreignCat,
      })
      expect(res.status).toBe(400)
    })

    it('POST rejects an archived category', async () => {
      const catId = await createCategory(groupId, cookie, 'Food')
      await app.request(`/api/fish-pie/groups/${groupId}/categories/${catId}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      const res = await createExpense(groupId, cookie, {
        description: 'Dinner', amount: '40.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: catId,
      })
      expect(res.status).toBe(400)
    })
  })

  describe('account resolution order', () => {
    it('uses the category mapping over the member default', async () => {
      const defaultAcct = await createAccount(cookie, 'expenses:misc')
      await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultExpenseAccountId: defaultAcct }),
      })
      const catAcct = await createAccount(cookie, 'expenses:food')
      const catId = await createCategory(groupId, cookie, 'Food')
      await setMapping(groupId, catId, cookie, { accountId: catAcct })

      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Dinner', amount: '50.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: catId,
      })).json()) as any
      expect(expense.categoryId).toBe(catId)
      expect(expense.categoryName).toBe('Food')

      // Sole-member payer tx: expense leg posts to the category-mapped account
      const [tx] = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
      const ps = await db.select().from(postings).where(eq(postings.transactionId, tx.id))
      const credit = ps.find((p) => parseFloat(p.amount) > 0)!
      expect(await accountPath(credit.accountId)).toBe('expenses:food')
    })

    it('falls back to the member default when the category has no mapping', async () => {
      const defaultAcct = await createAccount(cookie, 'expenses:misc')
      await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultExpenseAccountId: defaultAcct }),
      })
      const catId = await createCategory(groupId, cookie, 'Food')

      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Dinner', amount: '50.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: catId,
      })).json()) as any
      const [tx] = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
      const ps = await db.select().from(postings).where(eq(postings.transactionId, tx.id))
      const credit = ps.find((p) => parseFloat(p.amount) > 0)!
      expect(await accountPath(credit.accountId)).toBe('expenses:misc')
    })

    it('falls back to uncategorized when neither mapping nor default exists', async () => {
      const catId = await createCategory(groupId, cookie, 'Food')
      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Dinner', amount: '50.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: catId,
      })).json()) as any
      const [tx] = await db.select().from(transactions).where(eq(transactions.groupExpenseId, expense.id))
      const ps = await db.select().from(postings).where(eq(postings.transactionId, tx.id))
      const credit = ps.find((p) => parseFloat(p.amount) > 0)!
      expect(await accountPath(credit.accountId)).toBe('uncategorized')
    })
  })

  describe('weight resolution order (two members)', () => {
    let cookieB: string
    let userBId: string
    let catId: string

    beforeEach(async () => {
      cookieB = await createTestUser('b@test.com', 'passwordB')
      userBId = await getUserId(cookieB)
      await inviteAndAccept(groupId, cookie, 'b@test.com', cookieB)
      catId = await createCategory(groupId, cookie, 'Housing')
    })

    it('uses category weights when every member has one', async () => {
      // Category weights 60/40 (group weights are the default 1/1)
      const acctA = await createAccount(cookie, 'expenses:housing')
      const acctB = await createAccount(cookieB, 'expenses:rent')
      await setMapping(groupId, catId, cookie, { accountId: acctA, shareWeight: 60 })
      await setMapping(groupId, catId, cookieB, { accountId: acctB, shareWeight: 40 })

      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Rent', amount: '100.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: catId,
      })).json()) as any

      const splitA = expense.splits.find((s: any) => s.userId === userId)
      const splitB = expense.splits.find((s: any) => s.userId === userBId)
      expect(splitA.amount).toBe('60.00')
      expect(splitB.amount).toBe('40.00')
    })

    it('falls back to group weights when only one member has a category weight', async () => {
      const acctA = await createAccount(cookie, 'expenses:housing')
      // Only member A sets a category weight — should NOT reshape the split
      await setMapping(groupId, catId, cookie, { accountId: acctA, shareWeight: 90 })

      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Rent', amount: '100.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: catId,
      })).json()) as any

      // group weights are 1/1 → even 50/50 split
      const splitA = expense.splits.find((s: any) => s.userId === userId)
      const splitB = expense.splits.find((s: any) => s.userId === userBId)
      expect(splitA.amount).toBe('50.00')
      expect(splitB.amount).toBe('50.00')
    })

    it('explicit per-expense splits override category weights (on PATCH)', async () => {
      const acctA = await createAccount(cookie, 'expenses:housing')
      const acctB = await createAccount(cookieB, 'expenses:rent')
      await setMapping(groupId, catId, cookie, { accountId: acctA, shareWeight: 60 })
      await setMapping(groupId, catId, cookieB, { accountId: acctB, shareWeight: 40 })

      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Rent', amount: '100.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: catId,
      })).json()) as any

      // PATCH with explicit splits 1/1 should override the 60/40 category weights
      const patched = (await (await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ splits: [{ userId, shareWeight: 1 }, { userId: userBId, shareWeight: 1 }] }),
      })).json()) as any

      const splitA = patched.splits.find((s: any) => s.userId === userId)
      const splitB = patched.splits.find((s: any) => s.userId === userBId)
      expect(splitA.amount).toBe('50.00')
      expect(splitB.amount).toBe('50.00')
    })
  })

  describe('PATCH recategorization', () => {
    it('rebuilds member postings against the new category account', async () => {
      const foodAcct = await createAccount(cookie, 'expenses:food')
      const showsAcct = await createAccount(cookie, 'expenses:shows')
      const food = await createCategory(groupId, cookie, 'Food')
      const shows = await createCategory(groupId, cookie, 'Shows')
      await setMapping(groupId, food, cookie, { accountId: foodAcct })
      await setMapping(groupId, shows, cookie, { accountId: showsAcct })

      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Outing', amount: '50.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: food,
      })).json()) as any

      // recategorize Food → Shows
      const patched = (await (await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: shows }),
      })).json()) as any
      expect(patched.categoryId).toBe(shows)
      expect(patched.categoryName).toBe('Shows')

      // The live (non-deleted) member tx now credits the Shows account
      const txs = await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.groupExpenseId, expense.id), isNull(transactions.deletedAt)))
      expect(txs).toHaveLength(1)
      const ps = await db.select().from(postings).where(and(eq(postings.transactionId, txs[0].id), isNull(postings.deletedAt)))
      const credit = ps.find((p) => parseFloat(p.amount) > 0)!
      expect(await accountPath(credit.accountId)).toBe('expenses:shows')
    })

    it('clears the category when categoryId is explicitly null', async () => {
      const food = await createCategory(groupId, cookie, 'Food')
      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Outing', amount: '50.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId, categoryId: food,
      })).json()) as any

      const patched = (await (await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: null }),
      })).json()) as any
      expect(patched.categoryId).toBeNull()
      expect(patched.categoryName).toBeNull()
    })

    it('tolerates assigning an archived category on edit', async () => {
      const food = await createCategory(groupId, cookie, 'Food')
      const expense = (await (await createExpense(groupId, cookie, {
        description: 'Outing', amount: '50.00', currency: 'CAD', date: '2026-05-01',
        paymentAccountId,
      })).json()) as any
      await app.request(`/api/fish-pie/groups/${groupId}/categories/${food}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      const res = await app.request(`/api/fish-pie/groups/${groupId}/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: food }),
      })
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).categoryId).toBe(food)
    })
  })

  describe('import with category', () => {
    it('routes the payer expense leg through the category account', async () => {
      const foodAcct = await createAccount(cookie, 'expenses:food')
      const catId = await createCategory(groupId, cookie, 'Food')
      await setMapping(groupId, catId, cookie, { accountId: foodAcct })
      const sourceAcct = await createAccount(cookie, 'assets:chequing')

      const res = await app.request('/api/import/commit', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: sourceAcct,
          defaultCurrency: 'CAD',
          transactions: [{ isTransfer: false, date: '2026-05-02', amount: '-30.00', description: 'Lunch' }],
          groupSplits: [{ rowIndex: 0, groupId, categoryId: catId }],
        }),
      })
      expect(res.status).toBe(201)

      // The created expense carries the category
      const [expense] = await db.select().from(groupExpenses).where(eq(groupExpenses.groupId, groupId))
      expect(expense.categoryId).toBe(catId)

      // The import tx has a posting to the category-mapped expense account
      const ps = await db
        .select({ path: accounts.path })
        .from(postings)
        .innerJoin(accounts, eq(postings.accountId, accounts.id))
        .where(eq(postings.transactionId, expense.transactionId!))
      expect(ps.map((p) => p.path)).toContain('expenses:food')
    })

    it('without a category falls back to the member default expense account', async () => {
      const defaultAcct = await createAccount(cookie, 'expenses:misc')
      await app.request(`/api/fish-pie/groups/${groupId}/members/me`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultExpenseAccountId: defaultAcct }),
      })
      const sourceAcct = await createAccount(cookie, 'assets:chequing')

      const res = await app.request('/api/import/commit', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: sourceAcct,
          defaultCurrency: 'CAD',
          transactions: [{ isTransfer: false, date: '2026-05-02', amount: '-30.00', description: 'Lunch' }],
          groupSplits: [{ rowIndex: 0, groupId }],
        }),
      })
      expect(res.status).toBe(201)

      const [expense] = await db.select().from(groupExpenses).where(eq(groupExpenses.groupId, groupId))
      expect(expense.categoryId).toBeNull()
      const ps = await db
        .select({ path: accounts.path })
        .from(postings)
        .innerJoin(accounts, eq(postings.accountId, accounts.id))
        .where(eq(postings.transactionId, expense.transactionId!))
      expect(ps.map((p) => p.path)).toContain('expenses:misc')
    })

    it('rejects an archived category on import', async () => {
      const catId = await createCategory(groupId, cookie, 'Food')
      await app.request(`/api/fish-pie/groups/${groupId}/categories/${catId}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      const sourceAcct = await createAccount(cookie, 'assets:chequing')
      const res = await app.request('/api/import/commit', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: sourceAcct,
          defaultCurrency: 'CAD',
          transactions: [{ isTransfer: false, date: '2026-05-02', amount: '-30.00', description: 'Lunch' }],
          groupSplits: [{ rowIndex: 0, groupId, categoryId: catId }],
        }),
      })
      expect(res.status).toBe(400)
    })
  })
})
