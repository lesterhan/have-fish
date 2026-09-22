import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { db } from '../db'
import {
  accounts,
  expenseGroupMembers,
  expenseGroups,
  groupSettlements,
  postings,
  transactions,
  user,
  userSettings,
} from '../db/schema'
import { fail } from '../errors'
import { ensureSharedAccount } from '../fish-pie-accounts'

const app = new Hono<{ Variables: AppVariables }>()

async function fetchSettlementsWithNames(settlementIds: string[]) {
  if (settlementIds.length === 0) return []

  const settlements = await db
    .select()
    .from(groupSettlements)
    .where(inArray(groupSettlements.id, settlementIds))

  const userIds = [
    ...new Set([...settlements.map((s) => s.fromUserId), ...settlements.map((s) => s.toUserId)]),
  ]
  const users = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, userIds))
  const nameMap = new Map(users.map((u) => [u.id, u.name]))

  return settlements.map((s) => ({
    ...s,
    fromUserName: nameMap.get(s.fromUserId) ?? null,
    toUserName: nameMap.get(s.toUserId) ?? null,
  }))
}

// All of a group's settlements with payer/payee names, newest first.
// Shared by the settlements list endpoint and the group overview.
export async function fetchGroupSettlements(groupId: string) {
  const settlements = await db
    .select({ id: groupSettlements.id })
    .from(groupSettlements)
    .where(and(eq(groupSettlements.groupId, groupId), isNull(groupSettlements.deletedAt)))
  if (settlements.length === 0) return []
  const named = await fetchSettlementsWithNames(settlements.map((s) => s.id))
  return named.sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime(),
  )
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
  if (!group) return fail(c, 'GROUP_NOT_FOUND')

  const members = await db
    .select({ userId: expenseGroupMembers.userId })
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))

  const memberIds = new Set(members.map((m) => m.userId))
  if (!memberIds.has(userId)) return fail(c, 'GROUP_NOT_FOUND')

  const body = await c.req.json<{
    fromUserId?: string
    toUserId?: string
    amount?: string
    currency?: string
    date?: string
    note?: string
    payerAccountId?: string
  }>()

  if (!body.fromUserId || !memberIds.has(body.fromUserId))
    return fail(c, 'NAMED_USER_NOT_A_MEMBER', { field: 'fromUserId' })
  if (!body.toUserId || !memberIds.has(body.toUserId))
    return fail(c, 'NAMED_USER_NOT_A_MEMBER', { field: 'toUserId' })
  if (body.fromUserId === body.toUserId) return fail(c, 'SETTLEMENT_SAME_USER')
  if (body.fromUserId !== userId) return fail(c, 'ONLY_PAYER_CAN_SETTLE')
  if (!body.amount || Number.isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0)
    return fail(c, 'FIELD_NOT_POSITIVE_NUMBER', { field: 'amount' })
  if (!body.currency?.trim()) return fail(c, 'FIELD_REQUIRED', { field: 'currency' })
  if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/)) return fail(c, 'FIELD_NOT_DATE', { field: 'date' })
  if (!body.payerAccountId) return fail(c, 'FIELD_REQUIRED', { field: 'payerAccountId' })

  // Verify payer account belongs to the fromUser
  const [payerAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, body.payerAccountId),
        eq(accounts.userId, body.fromUserId),
        isNull(accounts.deletedAt),
      ),
    )
  if (!payerAccount) return fail(c, 'PAYER_ACCOUNT_NOT_FOUND')

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
    // credit group:<group> (payment into group recorded): +amount
    const sharedAccountId = await ensureSharedAccount(body.fromUserId!, group, tx)

    const [payerTx] = await tx
      .insert(transactions)
      .values({
        userId: body.fromUserId!,
        date: txDate,
        description: body.note?.trim() || `Settlement to ${group.name}`,
      })
      .returning()

    await tx.insert(postings).values([
      {
        transactionId: payerTx.id,
        accountId: body.payerAccountId!,
        amount: `-${amount}`,
        currency,
      },
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

// POST /api/fish-pie/groups/:groupId/settlements/batch
// Settles several debts (possibly across currencies) in ONE combined cash transaction.
// Each line clears a debt in its own currency (`debtAmount`/`debtCurrency`). A line is
// NATIVE when settledCurrency === debtCurrency (pay the debt as-is); CONVERTED when the
// payer pays a different currency (settledAmount/settledCurrency) bridged through their
// equity:conversions account — same posting shape as cross-currency transfers in import.ts.
//
// The balance math still nets per debt currency, so each line yields one groupSettlements
// row in its debt currency. All rows in the batch share a batchId + the one payer tx.
// Body: { payerAccountId, date, note?, lines: [{ toUserId, debtAmount, debtCurrency, settledAmount, settledCurrency, fxRate? }] }
app.post('/groups/:groupId/settlements/batch', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return fail(c, 'GROUP_NOT_FOUND')

  const members = await db
    .select({ userId: expenseGroupMembers.userId })
    .from(expenseGroupMembers)
    .where(eq(expenseGroupMembers.groupId, groupId))
  const memberIds = new Set(members.map((m) => m.userId))
  if (!memberIds.has(userId)) return fail(c, 'GROUP_NOT_FOUND')

  const body = await c.req.json<{
    payerAccountId?: string
    date?: string
    note?: string
    lines?: {
      toUserId?: string
      debtAmount?: string
      debtCurrency?: string
      settledAmount?: string
      settledCurrency?: string
      fxRate?: string
    }[]
  }>()

  if (!body.payerAccountId) return fail(c, 'FIELD_REQUIRED', { field: 'payerAccountId' })
  if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/)) return fail(c, 'FIELD_NOT_DATE', { field: 'date' })
  if (!Array.isArray(body.lines) || body.lines.length === 0)
    return fail(c, 'FIELD_EMPTY', { field: 'lines' })

  // The payer is always the caller — the cash leaves their account.
  const [payerAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, body.payerAccountId),
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
      ),
    )
  if (!payerAccount) return fail(c, 'PAYER_ACCOUNT_NOT_FOUND')

  type NormLine = {
    toUserId: string
    debtAmount: string
    debtCurrency: string
    settledAmount: string
    settledCurrency: string
    fxRate: string | null
    converted: boolean
  }
  const lines: NormLine[] = []
  for (const l of body.lines) {
    if (!l.toUserId || !memberIds.has(l.toUserId))
      return fail(c, 'NAMED_USER_NOT_A_MEMBER', { field: 'toUserId' })
    if (l.toUserId === userId) return fail(c, 'SETTLEMENT_SAME_USER')
    if (!l.debtAmount || Number.isNaN(parseFloat(l.debtAmount)) || parseFloat(l.debtAmount) <= 0)
      return fail(c, 'FIELD_NOT_POSITIVE_NUMBER', { field: 'debtAmount' })
    if (!l.debtCurrency?.trim()) return fail(c, 'FIELD_REQUIRED', { field: 'debtCurrency' })
    if (
      !l.settledAmount ||
      Number.isNaN(parseFloat(l.settledAmount)) ||
      parseFloat(l.settledAmount) <= 0
    )
      return fail(c, 'FIELD_NOT_POSITIVE_NUMBER', { field: 'settledAmount' })
    if (!l.settledCurrency?.trim()) return fail(c, 'FIELD_REQUIRED', { field: 'settledCurrency' })

    const debtCurrency = l.debtCurrency.trim().toUpperCase()
    const settledCurrency = l.settledCurrency.trim().toUpperCase()
    const debtAmount = parseFloat(l.debtAmount).toFixed(2)
    const settledAmount = parseFloat(l.settledAmount).toFixed(2)
    const converted = settledCurrency !== debtCurrency

    if (!converted && debtAmount !== settledAmount)
      return fail(c, 'SETTLEMENT_NATIVE_AMOUNT_MISMATCH')
    if (converted && (!l.fxRate || Number.isNaN(parseFloat(l.fxRate)) || parseFloat(l.fxRate) <= 0))
      return fail(c, 'SETTLEMENT_FX_RATE_REQUIRED')

    lines.push({
      toUserId: l.toUserId,
      debtAmount,
      debtCurrency,
      settledAmount,
      settledCurrency,
      fxRate: converted ? parseFloat(l.fxRate!).toFixed(6) : null,
      converted,
    })
  }

  // Cross-currency lines need the payer's conversion account to bridge currencies.
  let conversionAccountId: string | null = null
  if (lines.some((l) => l.converted)) {
    const [settings] = await db
      .select({ conversionAccountId: userSettings.defaultConversionAccountId })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
    conversionAccountId = settings?.conversionAccountId ?? null
    if (!conversionAccountId) return fail(c, 'CONVERSION_ACCOUNT_REQUIRED')
  }

  const txDate = new Date(`${body.date}T00:00:00Z`)
  const batchId = randomUUID()

  const result = await db.transaction(async (tx) => {
    const sharedAccountId = await ensureSharedAccount(userId, group, tx)

    const [payerTx] = await tx
      .insert(transactions)
      .values({
        userId,
        date: txDate,
        description: body.note?.trim() || `Settlement to ${group.name}`,
      })
      .returning()

    const postingRows: {
      transactionId: string
      accountId: string
      amount: string
      currency: string
    }[] = []

    // One combined cash leg per settled currency (single bank movement per currency).
    const cashByCurrency = new Map<string, number>()
    for (const l of lines) {
      cashByCurrency.set(
        l.settledCurrency,
        (cashByCurrency.get(l.settledCurrency) ?? 0) + parseFloat(l.settledAmount),
      )
    }
    for (const [currency, total] of cashByCurrency) {
      postingRows.push({
        transactionId: payerTx.id,
        accountId: body.payerAccountId!,
        amount: (-total).toFixed(2),
        currency,
      })
    }

    // Credit the payer's clearing account per debt; bridge converted lines through
    // equity:conversions so every currency nets to zero.
    for (const l of lines) {
      postingRows.push({
        transactionId: payerTx.id,
        accountId: sharedAccountId,
        amount: l.debtAmount,
        currency: l.debtCurrency,
      })
      if (l.converted) {
        postingRows.push({
          transactionId: payerTx.id,
          accountId: conversionAccountId!,
          amount: l.settledAmount,
          currency: l.settledCurrency,
        })
        postingRows.push({
          transactionId: payerTx.id,
          accountId: conversionAccountId!,
          amount: `-${l.debtAmount}`,
          currency: l.debtCurrency,
        })
      }
    }

    await tx.insert(postings).values(postingRows)

    const inserted = await tx
      .insert(groupSettlements)
      .values(
        lines.map((l) => ({
          groupId,
          fromUserId: userId,
          toUserId: l.toUserId,
          amount: l.debtAmount,
          currency: l.debtCurrency,
          // Native lines leave the FX columns null (settledAmount/Currency == debt).
          settledAmount: l.converted ? l.settledAmount : null,
          settledCurrency: l.converted ? l.settledCurrency : null,
          fxRate: l.fxRate,
          batchId,
          date: body.date!,
          note: body.note?.trim() || null,
          status: 'pending' as const,
          payerAccountId: body.payerAccountId,
          payerTransactionId: payerTx.id,
        })),
      )
      .returning()

    return inserted
  })

  const named = await fetchSettlementsWithNames(result.map((s) => s.id))
  return c.json({ batchId, settlements: named }, 201)
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
    .where(
      and(
        eq(groupSettlements.id, settlementId),
        eq(groupSettlements.groupId, groupId),
        isNull(groupSettlements.deletedAt),
      ),
    )
  if (!settlement) return fail(c, 'SETTLEMENT_NOT_FOUND')

  if (settlement.toUserId !== userId) return fail(c, 'ONLY_RECIPIENT_CAN_CONFIRM')
  if (settlement.status === 'completed') return fail(c, 'SETTLEMENT_ALREADY_CONFIRMED')
  // Batch rows (esp. cross-currency) must confirm through the batch endpoint, which
  // books the cash leg in the settled currency. This single-row path would wrongly
  // book the debt currency/amount as the cash received.
  if (settlement.batchId) return fail(c, 'SETTLEMENT_NEEDS_BATCH_CONFIRM')

  const body = await c.req.json<{ receiverAccountId?: string }>()
  if (!body.receiverAccountId) return fail(c, 'FIELD_REQUIRED', { field: 'receiverAccountId' })

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return fail(c, 'GROUP_NOT_FOUND')

  const [receiverAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, body.receiverAccountId),
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
      ),
    )
  if (!receiverAccount) return fail(c, 'RECEIVER_ACCOUNT_NOT_FOUND')

  const result = await db.transaction(async (tx) => {
    // Receiver's ledger transaction:
    // credit receiverAccount (cash in): +amount
    // debit group:<group> (payment received, clears shared balance): -amount
    const sharedAccountId = await ensureSharedAccount(userId, group, tx)
    const txDate = new Date(`${settlement.date}T00:00:00Z`)

    const [receiverTx] = await tx
      .insert(transactions)
      .values({
        userId,
        date: txDate,
        description: settlement.note || `Settlement from ${group.name}`,
      })
      .returning()

    await tx.insert(postings).values([
      {
        transactionId: receiverTx.id,
        accountId: body.receiverAccountId!,
        amount: settlement.amount,
        currency: settlement.currency,
      },
      {
        transactionId: receiverTx.id,
        accountId: sharedAccountId,
        amount: `-${settlement.amount}`,
        currency: settlement.currency,
      },
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

// POST /api/fish-pie/groups/:groupId/settlements/batch/:batchId/confirm
// Receiver confirms a batch: books ONE combined receiving transaction mirroring the
// payer's, then flips every pending row in the batch addressed to the caller to
// completed. A batch can name more than one receiver (e.g. owe two people at once);
// each receiver confirms only the rows addressed to them.
// Body: { receiverAccountId }
app.post('/groups/:groupId/settlements/batch/:batchId/confirm', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const batchId = c.req.param('batchId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return fail(c, 'GROUP_NOT_FOUND')

  // Rows in this batch addressed to the caller (the receiver).
  const rows = await db
    .select()
    .from(groupSettlements)
    .where(
      and(
        eq(groupSettlements.batchId, batchId),
        eq(groupSettlements.groupId, groupId),
        eq(groupSettlements.toUserId, userId),
        isNull(groupSettlements.deletedAt),
      ),
    )
  if (rows.length === 0) return fail(c, 'SETTLEMENT_NOT_FOUND')
  if (rows.every((r) => r.status === 'completed')) return fail(c, 'SETTLEMENT_ALREADY_CONFIRMED')
  const pending = rows.filter((r) => r.status !== 'completed')

  const body = await c.req.json<{ receiverAccountId?: string }>()
  if (!body.receiverAccountId) return fail(c, 'FIELD_REQUIRED', { field: 'receiverAccountId' })

  const [receiverAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, body.receiverAccountId),
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
      ),
    )
  if (!receiverAccount) return fail(c, 'RECEIVER_ACCOUNT_NOT_FOUND')

  // Cross-currency rows need the receiver's conversion account to bridge currencies.
  const hasConverted = pending.some((r) => r.settledCurrency !== null)
  let conversionAccountId: string | null = null
  if (hasConverted) {
    const [settings] = await db
      .select({ conversionAccountId: userSettings.defaultConversionAccountId })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
    conversionAccountId = settings?.conversionAccountId ?? null
    if (!conversionAccountId) return fail(c, 'CONVERSION_ACCOUNT_REQUIRED')
  }

  const result = await db.transaction(async (tx) => {
    const sharedAccountId = await ensureSharedAccount(userId, group, tx)
    // All rows in a batch share the payer's date; use the first.
    const txDate = new Date(`${pending[0].date}T00:00:00Z`)

    const [receiverTx] = await tx
      .insert(transactions)
      .values({
        userId,
        date: txDate,
        description: pending[0].note || `Settlement from ${group.name}`,
      })
      .returning()

    const postingRows: {
      transactionId: string
      accountId: string
      amount: string
      currency: string
    }[] = []

    // One combined cash-in leg per received currency (mirror of the payer's cash-out).
    const cashByCurrency = new Map<string, number>()
    for (const r of pending) {
      const cashCurrency = r.settledCurrency ?? r.currency
      const cashAmount = parseFloat(r.settledAmount ?? r.amount)
      cashByCurrency.set(cashCurrency, (cashByCurrency.get(cashCurrency) ?? 0) + cashAmount)
    }
    for (const [currency, total] of cashByCurrency) {
      postingRows.push({
        transactionId: receiverTx.id,
        accountId: body.receiverAccountId!,
        amount: total.toFixed(2),
        currency,
      })
    }

    // Drain the receiver's clearing account per debt; bridge converted rows through
    // their equity:conversions so every currency nets to zero.
    for (const r of pending) {
      postingRows.push({
        transactionId: receiverTx.id,
        accountId: sharedAccountId,
        amount: `-${r.amount}`,
        currency: r.currency,
      })
      if (r.settledCurrency !== null) {
        postingRows.push({
          transactionId: receiverTx.id,
          accountId: conversionAccountId!,
          amount: `-${r.settledAmount}`,
          currency: r.settledCurrency,
        })
        postingRows.push({
          transactionId: receiverTx.id,
          accountId: conversionAccountId!,
          amount: r.amount,
          currency: r.currency,
        })
      }
    }

    await tx.insert(postings).values(postingRows)

    const updated = await tx
      .update(groupSettlements)
      .set({ status: 'completed', receiverTransactionId: receiverTx.id })
      .where(
        inArray(
          groupSettlements.id,
          pending.map((r) => r.id),
        ),
      )
      .returning()

    return updated
  })

  const named = await fetchSettlementsWithNames(result.map((s) => s.id))
  return c.json({ batchId, settlements: named })
})

// GET /api/fish-pie/groups/:groupId/settlements
app.get('/groups/:groupId/settlements', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return fail(c, 'GROUP_NOT_FOUND')

  const [membership] = await db
    .select()
    .from(expenseGroupMembers)
    .where(and(eq(expenseGroupMembers.groupId, groupId), eq(expenseGroupMembers.userId, userId)))
  if (!membership) return fail(c, 'GROUP_NOT_FOUND')

  return c.json(await fetchGroupSettlements(groupId))
})

// DELETE /api/fish-pie/groups/:groupId/settlements/:settlementId
app.delete('/groups/:groupId/settlements/:settlementId', async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('groupId')
  const settlementId = c.req.param('settlementId')

  const [settlement] = await db
    .select()
    .from(groupSettlements)
    .where(
      and(
        eq(groupSettlements.id, settlementId),
        eq(groupSettlements.groupId, groupId),
        isNull(groupSettlements.deletedAt),
      ),
    )
  if (!settlement) return fail(c, 'SETTLEMENT_NOT_FOUND')

  const [group] = await db
    .select()
    .from(expenseGroups)
    .where(and(eq(expenseGroups.id, groupId), isNull(expenseGroups.deletedAt)))
  if (!group) return fail(c, 'GROUP_NOT_FOUND')

  const isParty = settlement.fromUserId === userId || settlement.toUserId === userId
  const isCreator = group.createdBy === userId
  if (!isParty && !isCreator) return fail(c, 'NOT_A_PARTY_OR_GROUP_CREATOR')

  // A batch shares one payer transaction across all its rows, so a single row can't be
  // removed in isolation without unbalancing that transaction — delete the whole batch
  // (every row + the shared payer tx + each receiver tx).
  const siblings = settlement.batchId
    ? await db
        .select()
        .from(groupSettlements)
        .where(
          and(eq(groupSettlements.batchId, settlement.batchId), isNull(groupSettlements.deletedAt)),
        )
    : [settlement]

  const settlementIds = siblings.map((s) => s.id)
  const txIds = [
    ...new Set(
      siblings
        .flatMap((s) => [s.payerTransactionId, s.receiverTransactionId])
        .filter((id): id is string => id !== null),
    ),
  ]

  await db.transaction(async (tx) => {
    await tx
      .update(groupSettlements)
      .set({ deletedAt: new Date() })
      .where(inArray(groupSettlements.id, settlementIds))

    if (txIds.length > 0) {
      await tx
        .update(transactions)
        .set({ deletedAt: new Date() })
        .where(inArray(transactions.id, txIds))
      await tx
        .update(postings)
        .set({ deletedAt: new Date() })
        .where(inArray(postings.transactionId, txIds))
    }
  })

  return new Response(null, { status: 204 })
})

export default app
