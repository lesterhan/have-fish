import { Hono } from 'hono'
import { db } from '../db'
import { expenseGroups, expenseGroupMembers, groupSettlements, user, accounts, transactions, postings } from '../db/schema'
import { eq, isNull, and, inArray, desc } from 'drizzle-orm'
import type { AppVariables } from '../app'
import { ensureSharedAccount } from '../fish-pie-accounts'

const app = new Hono<{ Variables: AppVariables }>()

async function fetchSettlementsWithNames(settlementIds: string[]) {
  if (settlementIds.length === 0) return []

  const settlements = await db
    .select()
    .from(groupSettlements)
    .where(inArray(groupSettlements.id, settlementIds))

  const userIds = [...new Set([...settlements.map((s) => s.fromUserId), ...settlements.map((s) => s.toUserId)])]
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))
  const nameMap = new Map(users.map((u) => [u.id, u.name]))

  return settlements.map((s) => ({
    ...s,
    fromUserName: nameMap.get(s.fromUserId) ?? null,
    toUserName: nameMap.get(s.toUserId) ?? null,
  }))
}

// POST /api/fish-pie/groups/:groupId/settlements
// Creates a pending settlement and immediately records the payer's ledger transaction.
// Body: { fromUserId, toUserId, amount, currency, date, note?, payerAccountId }
app.post('/groups/:groupId/settlements', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const members = await db
    .select({ userId: expenseGroupMembers.userId })
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  const memberIds = new Set(members.map((m) => m.userId))
  if (!memberIds.has(userId)) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{
    fromUserId?: string
    toUserId?: string
    amount?: string
    currency?: string
    date?: string
    note?: string
    payerAccountId?: string
  }>()

  if (!body.fromUserId || !memberIds.has(body.fromUserId)) return c.json({ error: 'fromUserId must be a group member' }, 400)
  if (!body.toUserId || !memberIds.has(body.toUserId)) return c.json({ error: 'toUserId must be a group member' }, 400)
  if (body.fromUserId === body.toUserId) return c.json({ error: 'from and to must differ' }, 400)
  if (!body.amount || isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0)
    return c.json({ error: 'amount must be a positive number' }, 400)
  if (!body.currency?.trim()) return c.json({ error: 'currency is required' }, 400)
  if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  if (!body.payerAccountId) return c.json({ error: 'payerAccountId is required' }, 400)

  // Verify payer account belongs to the fromUser
  const [payerAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, body.payerAccountId), eq(accounts.userId, body.fromUserId), isNull(accounts.deletedAt)))
  if (!payerAccount) return c.json({ error: 'payerAccountId not found' }, 400)

  const amount = parseFloat(body.amount).toFixed(2)
  const currency = body.currency.trim().toUpperCase()
  const txDate = new Date(`${body.date}T00:00:00Z`)

  const result = await db.transaction(async (tx) => {
    const [settlement] = await tx
      .insert(groupSettlements)
      .values({
        groupId,
        fromUserId: body.fromUserId!,
        toUserId: body.toUserId!,
        amount,
        currency,
        date: body.date!,
        note: body.note?.trim() || null,
        status: 'pending',
        payerAccountId: body.payerAccountId,
      })
      .returning()

    // Payer's ledger transaction:
    // debit payerAccount (cash out): -amount
    // credit shared:<group> (payment into group recorded): +amount
    const sharedAccountId = await ensureSharedAccount(body.fromUserId!, group, tx)

    const [payerTx] = await tx
      .insert(transactions)
      .values({
        userId: body.fromUserId!,
        date: txDate,
        description: body.note?.trim() || `Settlement to group`,
      })
      .returning()

    await tx.insert(postings).values([
      { transactionId: payerTx.id, accountId: body.payerAccountId!, amount: `-${amount}`, currency },
      { transactionId: payerTx.id, accountId: sharedAccountId, amount, currency },
    ])

    const [updated] = await tx
      .update(groupSettlements)
      .set({ payerTransactionId: payerTx.id })
      .where(eq(groupSettlements.id, settlement.id))
      .returning()

    return updated
  })

  const [withNames] = await fetchSettlementsWithNames([result.id])
  return c.json(withNames, 201)
})

// POST /api/fish-pie/groups/:groupId/settlements/:settlementId/confirm
// Receiver confirms receipt: creates their ledger transaction and marks settlement completed.
// Body: { receiverAccountId }
app.post('/groups/:groupId/settlements/:settlementId/confirm', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const settlementId = c.req.param('settlementId')

  const [settlement] = await db
    .select()
    .from(groupSettlements)
    .where(and(eq(groupSettlements.id, settlementId), eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt)))
  if (!settlement) return c.json({ error: 'not found' }, 404)

  if (settlement.toUserId !== userId) return c.json({ error: 'forbidden' }, 403)
  if (settlement.status === 'completed') return c.json({ error: 'already confirmed' }, 409)

  const body = await c.req.json<{ receiverAccountId?: string }>()
  if (!body.receiverAccountId) return c.json({ error: 'receiverAccountId is required' }, 400)

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const [receiverAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, body.receiverAccountId), eq(accounts.userId, userId), isNull(accounts.deletedAt)))
  if (!receiverAccount) return c.json({ error: 'receiverAccountId not found' }, 400)

  const result = await db.transaction(async (tx) => {
    // Receiver's ledger transaction:
    // credit receiverAccount (cash in): +amount
    // debit shared:<group> (payment received, clears shared balance): -amount
    const sharedAccountId = await ensureSharedAccount(userId, group, tx)
    const txDate = new Date(`${settlement.date}T00:00:00Z`)

    const [receiverTx] = await tx
      .insert(transactions)
      .values({
        userId,
        date: txDate,
        description: settlement.note || `Settlement from group`,
      })
      .returning()

    await tx.insert(postings).values([
      { transactionId: receiverTx.id, accountId: body.receiverAccountId!, amount: settlement.amount, currency: settlement.currency },
      { transactionId: receiverTx.id, accountId: sharedAccountId, amount: `-${settlement.amount}`, currency: settlement.currency },
    ])

    const [updated] = await tx
      .update(groupSettlements)
      .set({ status: 'completed', receiverTransactionId: receiverTx.id })
      .where(eq(groupSettlements.id, settlementId))
      .returning()

    return updated
  })

  const [withNames] = await fetchSettlementsWithNames([result.id])
  return c.json(withNames)
})

// GET /api/fish-pie/groups/:groupId/settlements
app.get('/groups/:groupId/settlements', async (c) => {
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

  const settlements = await db
    .select()
    .from(groupSettlements)
    .where(and(eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt)))
    .orderBy(desc(groupSettlements.date), desc(groupSettlements.createdAt))

  if (settlements.length === 0) return c.json([])
  return c.json(await fetchSettlementsWithNames(settlements.map((s) => s.id)))
})

// DELETE /api/fish-pie/groups/:groupId/settlements/:settlementId
app.delete('/groups/:groupId/settlements/:settlementId', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const settlementId = c.req.param('settlementId')

  const [settlement] = await db
    .select()
    .from(groupSettlements)
    .where(and(eq(groupSettlements.id, settlementId), eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt)))
  if (!settlement) return c.json({ error: 'not found' }, 404)

  const [group] = await db.select().from(expenseGroups).where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return c.json({ error: 'not found' }, 404)

  const isParty = settlement.fromUserId === userId || settlement.toUserId === userId
  const isCreator = group.createdBy === userId
  if (!isParty && !isCreator) return c.json({ error: 'forbidden' }, 403)

  await db.transaction(async (tx) => {
    await tx.update(groupSettlements).set({ deletedAt: new Date() }).where(eq(groupSettlements.id, settlementId))

    // Soft-delete linked ledger transactions
    const txIds = [settlement.payerTransactionId, settlement.receiverTransactionId].filter((id): id is string => id !== null)
    if (txIds.length > 0) {
      await tx.update(transactions).set({ deletedAt: new Date() }).where(inArray(transactions.id, txIds))
      await tx.update(postings).set({ deletedAt: new Date() }).where(inArray(postings.transactionId, txIds))
    }
  })

  return new Response(null, { status: 204 })
})

export default app
