import { Hono } from 'hono'
import { db } from '../db'
import { groupExpenses, groupExpenseSplits, groupCategories, expenseGroupMembers, expenseGroups, transactions, postings, accounts, user } from '../db/schema'
import { eq, isNull, and, inArray, getTableColumns } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { computeSplits, createGroupExpenseInTx, createMemberTransactionsInTx, resolveCategoryContext, resolveExpenseAccountId, applyCategoryWeights } from '../fish-pie-expense-service'
import { isClearingAccountPath } from '../fish-pie-accounts'

// Validate a categoryId against a group. Returns 'ok' | 'not-found' | 'archived'.
// Callers decide whether 'archived' is fatal (create) or tolerated (edit).
async function validateCategory(categoryId: string, groupId: string): Promise<'ok' | 'not-found' | 'archived'> {
  const [cat] = await db
    .select({ id: groupCategories.id, archivedAt: groupCategories.archivedAt })
    .from(groupCategories)
    .where(and(eq(groupCategories.id, categoryId), eq(groupCategories.groupId, groupId)))
  if (!cat) return 'not-found'
  if (cat.archivedAt) return 'archived'
  return 'ok'
}

const app = new Hono<{ Variables: AppVariables }>()

export async function fetchExpenseWithDetails(expenseIds: string[]) {
  if (expenseIds.length === 0) return []

  const [expenses, splits] = await Promise.all([
    db
      .select({ ...getTableColumns(groupExpenses), categoryName: groupCategories.name })
      .from(groupExpenses)
      .leftJoin(groupCategories, eq(groupExpenses.categoryId, groupCategories.id))
      .where(inArray(groupExpenses.id, expenseIds)),
    // Join through groupExpenses → expenseGroupMembers → accounts to get each
    // member's configured expense account path for the delete impact dialog.
    db
      .select({
        id: groupExpenseSplits.id,
        expenseId: groupExpenseSplits.expenseId,
        userId: groupExpenseSplits.userId,
        amount: groupExpenseSplits.amount,
        userName: user.name,
        expenseAccountPath: accounts.path,
      })
      .from(groupExpenseSplits)
      .innerJoin(user, eq(groupExpenseSplits.userId, user.id))
      .innerJoin(groupExpenses, eq(groupExpenseSplits.expenseId, groupExpenses.id))
      .leftJoin(
        expenseGroupMembers,
        and(
          eq(expenseGroupMembers.groupId, groupExpenses.groupId),
          eq(expenseGroupMembers.userId, groupExpenseSplits.userId),
        ),
      )
      .leftJoin(accounts, eq(accounts.id, expenseGroupMembers.defaultExpenseAccountId))
      .where(inArray(groupExpenseSplits.expenseId, expenseIds)),
  ])

  const payerIds = [...new Set(expenses.map((e) => e.paidByUserId))]
  const payers = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, payerIds))
  const userMap = new Map(payers.map((u) => [u.id, u.name]))

  return expenses.map((e) => ({
    ...e,
    payerName: userMap.get(e.paidByUserId) ?? null,
    splits: splits.filter((s) => s.expenseId === e.id),
  }))
}

// All of a group's active expenses with details, newest first. Shared by the
// expenses list endpoint and the group overview.
export async function fetchGroupExpenses(groupId: string) {
  const rows = await db
    .select({ id: groupExpenses.id })
    .from(groupExpenses)
    .where(and(eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
  if (rows.length === 0) return []
  const detailed = await fetchExpenseWithDetails(rows.map((r) => r.id))
  // Sort newest-first here — fetchExpenseWithDetails fetches by id set and doesn't
  // guarantee order on its own.
  return detailed.sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime(),
  )
}

// POST /api/fish-pie/groups/:groupId/expenses
app.post('/groups/:groupId/expenses', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await db
    .select()
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  if (!members.some((m) => m.userId === userId)) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{
    description?: string
    amount?: string
    currency?: string
    date?: string
    paidByUserId?: string
    paymentAccountId?: string
    categoryId?: string | null
  }>()

  if (!body.description?.trim()) return c.json({ error: 'description is required' }, 400)
  if (!body.amount || isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0)
    return c.json({ error: 'amount must be a positive number' }, 400)
  if (!body.currency?.trim()) return c.json({ error: 'currency is required' }, 400)
  if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (!body.paymentAccountId?.trim()) return c.json({ error: 'paymentAccountId is required' }, 400)

  // Categorizing is optional; if given the category must belong to the group and be active.
  if (body.categoryId) {
    const result = await validateCategory(body.categoryId, groupId)
    if (result === 'not-found') return c.json({ error: 'category not found in this group' }, 400)
    if (result === 'archived') return c.json({ error: 'cannot assign an archived category' }, 400)
  }

  const payerId = body.paidByUserId ?? userId
  if (!members.some((m) => m.userId === payerId)) return c.json({ error: 'payer is not a member' }, 400)

  // Validate payment account belongs to the payer
  const [paymentAcct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, body.paymentAccountId), eq(accounts.userId, payerId), isNull(accounts.deletedAt)))
  if (!paymentAcct) return c.json({ error: 'payment account not found or does not belong to payer' }, 400)

  const expenseId = await db.transaction(async (tx) => {
    const id = await createGroupExpenseInTx(tx, {
      group,
      members,
      payerId,
      description: body.description!,
      amount: body.amount!,
      currency: body.currency!,
      date: body.date!,
      paymentAccountId: body.paymentAccountId,
      categoryId: body.categoryId ?? null,
    })

    // Auto-save the payer's defaultPaymentAccountId if it changed
    const payerMember = members.find((m) => m.userId === payerId)!
    if (payerMember.defaultPaymentAccountId !== body.paymentAccountId) {
      await tx
        .update(expenseGroupMembers)
        .set({ defaultPaymentAccountId: body.paymentAccountId })
        .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, payerId)))
    }

    return id
  })

  const [withDetails] = await fetchExpenseWithDetails([expenseId])
  return c.json(withDetails, 201)
})

// GET /api/fish-pie/groups/:groupId/expenses
app.get('/groups/:groupId/expenses', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const [membership] = await db
    .select()
    .from(expenseGroupMembers)
    .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, userId)))
  if (!membership) return c.json({ error: 'not found' }, 404)

  return c.json(await fetchGroupExpenses(groupId))
})

// PATCH /api/fish-pie/groups/:groupId/expenses/:expenseId
app.patch('/groups/:groupId/expenses/:expenseId', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const expenseId = c.req.param('expenseId')

  const [expense] = await db
    .select()
    .from(groupExpenses)
    .where(and(eq(groupExpenses.id, expenseId), eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
  if (!expense) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, groupId))
  if (!group) return c.json({ error: 'not found' }, 404)

  const isPayer = expense.paidByUserId === userId
  const isCreator = group.createdBy === userId
  if (!isPayer && !isCreator) return c.json({ error: 'forbidden' }, 403)

  const members = await db
    .select()
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  const body = await c.req.json<{
    description?: string
    amount?: string
    currency?: string
    date?: string
    paidByUserId?: string
    splits?: { userId: string; shareWeight: number }[]
    paymentAccountId?: string
    categoryId?: string | null
  }>()

  // Recategorization is optional. Omitted → keep existing; explicit null → clear it.
  // Archived categories are tolerated on edit (the category may have been archived
  // after this expense was first assigned) but must still belong to the group.
  const categoryProvided = 'categoryId' in body
  const newCategoryId = categoryProvided ? (body.categoryId ?? null) : expense.categoryId
  if (categoryProvided && body.categoryId) {
    const result = await validateCategory(body.categoryId, groupId)
    if (result === 'not-found') return c.json({ error: 'category not found in this group' }, 400)
  }

  const description = body.description?.trim() ?? expense.description
  const amount = body.amount ?? expense.amount
  const currency = body.currency?.trim().toUpperCase() ?? expense.currency
  const date = body.date ?? expense.date
  const payerId = body.paidByUserId ?? expense.paidByUserId

  if (!description) return c.json({ error: 'description is required' }, 400)
  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return c.json({ error: 'amount must be a positive number' }, 400)
  if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (!members.some((m) => m.userId === payerId)) return c.json({ error: 'payer is not a member' }, 400)

  if (body.paymentAccountId) {
    const [paymentAcct] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, body.paymentAccountId), eq(accounts.userId, payerId), isNull(accounts.deletedAt)))
    if (!paymentAcct) return c.json({ error: 'payment account not found or does not belong to payer' }, 400)
  }

  // BUG-006: the edit form doesn't send paymentAccountId, which used to rebuild the
  // payer's tx as a degraded 2-posting (source posting lost). For non-import-linked
  // expenses, resolve one: explicit body value > source recovered from the existing
  // payer tx (payer unchanged) > the payer's stored default. Derived values that
  // fail validation degrade to the legacy path rather than failing the edit.
  let paymentAccountId = body.paymentAccountId
  if (!paymentAccountId && !expense.transactionId) {
    if (payerId === expense.paidByUserId) {
      const [oldPayerTx] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(
          eq(transactions.groupExpenseId, expenseId),
          eq(transactions.userId, expense.paidByUserId),
          isNull(transactions.deletedAt),
        ))
      if (oldPayerTx) {
        const oldPostings = await db
          .select({ accountId: postings.accountId, amount: postings.amount })
          .from(postings)
          .where(and(eq(postings.transactionId, oldPayerTx.id), isNull(postings.deletedAt)))
        // Only a 3-posting payer tx records the source (its single negative posting);
        // legacy 2-posting txs have nothing to recover.
        if (oldPostings.length === 3) {
          paymentAccountId = oldPostings.find((p) => parseFloat(p.amount) < 0)?.accountId
        }
      }
    }
    if (!paymentAccountId) {
      paymentAccountId = members.find((m) => m.userId === payerId)?.defaultPaymentAccountId ?? undefined
    }
    if (paymentAccountId) {
      const [acct] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, paymentAccountId), eq(accounts.userId, payerId), isNull(accounts.deletedAt)))
      if (!acct) paymentAccountId = undefined
    }
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    // Weight resolution order: explicit per-expense splits > category weights (when
    // every member has one) > stored group member weights. Account resolution per
    // member runs through the (new) category as well.
    const catCtx = await resolveCategoryContext(tx, newCategoryId, members)
    const membersForSplit = body.splits
      ? members.map((m) => ({
          ...m,
          shareWeight: body.splits!.find((s) => s.userId === m.userId)?.shareWeight ?? m.shareWeight,
        }))
      : applyCategoryWeights(members, catCtx)

    // Soft-delete existing member transactions + their postings (NOT the import tx)
    const memberTxRows = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.groupExpenseId, expenseId), isNull(transactions.deletedAt)))
    const memberTxIds = memberTxRows.map((t) => t.id)
    if (memberTxIds.length > 0) {
      await tx.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, memberTxIds))
      await tx.update(postings).set({ deletedAt: now }).where(inArray(postings.transactionId, memberTxIds))
    }

    // Update groupExpenses row in-place
    await tx
      .update(groupExpenses)
      .set({ description, amount: parseFloat(amount).toFixed(2), currency, date, paidByUserId: payerId, categoryId: newCategoryId })
      .where(eq(groupExpenses.id, expenseId))

    // Hard-delete old splits (no deletedAt on groupExpenseSplits) and insert recomputed ones
    const splits = computeSplits(amount, membersForSplit, payerId)
    await tx.delete(groupExpenseSplits).where(eq(groupExpenseSplits.expenseId, expenseId))
    await tx.insert(groupExpenseSplits).values(
      splits.map((s) => ({ expenseId, userId: s.userId, amount: s.amount })),
    )

    // Recreate member transactions with updated values
    await createMemberTransactionsInTx(tx, {
      expenseId,
      group,
      members,
      splits,
      description,
      currency,
      date,
      payerId,
      totalAmount: parseFloat(amount).toFixed(2),
      paymentAccountId,
      skipPayerMemberTx: !!expense.transactionId,
      categoryAccounts: catCtx.accounts,
    })

    // Auto-save the payer's defaultPaymentAccountId when explicitly changed
    // (parity with POST). Recovered/derived accounts don't overwrite the default.
    if (body.paymentAccountId) {
      const payerMember = members.find((m) => m.userId === payerId)!
      if (payerMember.defaultPaymentAccountId !== body.paymentAccountId) {
        await tx
          .update(expenseGroupMembers)
          .set({ defaultPaymentAccountId: body.paymentAccountId })
          .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, payerId)))
      }
    }

    // If import-linked: update the split postings on the import transaction
    if (expense.transactionId) {
      // The existing payer posting was written against the *old* category's account;
      // the rebuilt one resolves through the new category. Both fall back to the
      // member default → uncategorized.
      const oldCtx = await resolveCategoryContext(tx, expense.categoryId, members)
      const oldPayerMember = members.find((m) => m.userId === expense.paidByUserId)
      const oldExpenseAccountId = await resolveExpenseAccountId(tx, oldCtx.accounts, oldPayerMember, expense.paidByUserId)

      const newPayerMember = members.find((m) => m.userId === payerId)
      const newExpenseAccountId = await resolveExpenseAccountId(tx, catCtx.accounts, newPayerMember, payerId)

      const importPostings = await tx
        .select({
          id: postings.id,
          amount: postings.amount,
          currency: postings.currency,
          accountId: postings.accountId,
          accountPath: accounts.path,
        })
        .from(postings)
        .innerJoin(accounts, eq(postings.accountId, accounts.id))
        .where(and(eq(postings.transactionId, expense.transactionId), isNull(postings.deletedAt)))

      const groupPosting = importPostings.find((p) => isClearingAccountPath(p.accountPath))
      const expensePosting = importPostings.find((p) => p.accountId === oldExpenseAccountId)

      if (groupPosting && expensePosting) {
        await tx
          .update(postings)
          .set({ deletedAt: now })
          .where(inArray(postings.id, [groupPosting.id, expensePosting.id]))

        // Both postings share the same sign; their sum is the net target amount
        const netTarget = parseFloat(groupPosting.amount) + parseFloat(expensePosting.amount)
        const totalWeight = membersForSplit.reduce((s, m) => s + m.shareWeight, 0)
        const payerWeight = membersForSplit.find((m) => m.userId === payerId)?.shareWeight ?? 1
        const newPayerShare = (netTarget * (payerWeight / totalWeight)).toFixed(2)
        const newOthersShare = (netTarget - parseFloat(newPayerShare)).toFixed(2)
        const targetCurrency = groupPosting.currency

        await tx.insert(postings).values([
          {
            transactionId: expense.transactionId,
            accountId: groupPosting.accountId,
            amount: newOthersShare,
            currency: targetCurrency,
          },
          {
            transactionId: expense.transactionId,
            accountId: newExpenseAccountId,
            amount: newPayerShare,
            currency: targetCurrency,
          },
        ])
      }
    }
  })

  const [withDetails] = await fetchExpenseWithDetails([expenseId])
  return c.json(withDetails)
})

// DELETE /api/fish-pie/groups/:groupId/expenses/:expenseId
app.delete('/groups/:groupId/expenses/:expenseId', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const expenseId = c.req.param('expenseId')

  const [expense] = await db
    .select()
    .from(groupExpenses)
    .where(and(eq(groupExpenses.id, expenseId), eq(groupExpenses.groupId, groupId), isNull(groupExpenses.deletedAt)))
  if (!expense) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, groupId))
  if (!group) return c.json({ error: 'not found' }, 404)

  const isPayer = expense.paidByUserId === userId
  const isCreator = group.createdBy === userId
  if (!isPayer && !isCreator) return c.json({ error: 'forbidden' }, 403)

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(groupExpenses).set({ deletedAt: now }).where(eq(groupExpenses.id, expenseId))

    const linkedTxs = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expenseId))

    // Also include the import transaction if this expense was created via CSV import.
    // That transaction links in the opposite direction (groupExpenses.transactionId) so
    // the groupExpenseId query above misses it.
    const txIds = linkedTxs.map((t) => t.id)
    if (expense.transactionId) txIds.push(expense.transactionId)

    if (txIds.length > 0) {
      await tx.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, txIds))
      await tx.update(postings).set({ deletedAt: now }).where(inArray(postings.transactionId, txIds))
    }
  })
  return new Response(null, { status: 204 })
})

// DELETE /api/fish-pie/group-expenses/:expenseId
// Convenience endpoint: removes expense without requiring the group ID in the URL.
app.delete('/group-expenses/:expenseId', async (c) => {
  const userId = c.get('userId')
  const expenseId = c.req.param('expenseId')

  const [expense] = await db
    .select()
    .from(groupExpenses)
    .where(and(eq(groupExpenses.id, expenseId), isNull(groupExpenses.deletedAt)))
  if (!expense) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(eq(expenseGroups.id, expense.groupId))
  if (!group) return c.json({ error: 'not found' }, 404)

  const isPayer = expense.paidByUserId === userId
  const isCreator = group.createdBy === userId
  if (!isPayer && !isCreator) return c.json({ error: 'forbidden' }, 403)

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(groupExpenses).set({ deletedAt: now }).where(eq(groupExpenses.id, expenseId))

    const linkedTxs = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.groupExpenseId, expenseId))

    const txIds = linkedTxs.map((t) => t.id)
    if (expense.transactionId) txIds.push(expense.transactionId)

    if (txIds.length > 0) {
      await tx.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, txIds))
      await tx.update(postings).set({ deletedAt: now }).where(inArray(postings.transactionId, txIds))
    }
  })
  return new Response(null, { status: 204 })
})

export default app
