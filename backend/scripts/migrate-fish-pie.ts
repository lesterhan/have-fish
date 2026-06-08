// One-time migration: post existing Fish Pie group expenses into the personal ledger.
//
// For each group expense that has no linked transaction yet (transactionId IS NULL),
// create a transaction + two postings per member:
//   debit  → uncategorized (or member's defaultExpenseAccountId)
//   credit → shared:<group-slug>
//
// Idempotent: rows where transactionId is already set are skipped.
// All-or-nothing: runs in a single DB transaction.
//
// Usage: bun run scripts/migrate-fish-pie.ts

import { db } from '../src/db'
import { groupExpenses, groupExpenseSplits, expenseGroupMembers, expenseGroups, transactions, postings } from '../src/db/schema'
import { ensureSharedAccount, ensureUncategorizedAccount } from '../src/fish-pie-accounts'
import { eq, isNull, and } from 'drizzle-orm'

console.log('Fish Pie account integration migration')
console.log('---------------------------------------')

const pendingExpenses = await db
  .select()
  .from(groupExpenses)
  .where(and(isNull(groupExpenses.transactionId), isNull(groupExpenses.deletedAt)))

console.log(`Found ${pendingExpenses.length} expenses to migrate`)

if (pendingExpenses.length === 0) {
  console.log('Nothing to do.')
  process.exit(0)
}

let migrated = 0
let skipped = 0

await db.transaction(async (tx) => {
  for (const expense of pendingExpenses) {
    const [group] = await tx
      .select()
      .from(expenseGroups)
      .where(eq(expenseGroups.id, expense.groupId))

    if (!group) {
      console.warn(`  [SKIP] expense ${expense.id}: group not found`)
      skipped++
      continue
    }

    const splits = await tx
      .select()
      .from(groupExpenseSplits)
      .where(eq(groupExpenseSplits.expenseId, expense.id))

    if (splits.length === 0) {
      console.warn(`  [SKIP] expense ${expense.id}: no splits`)
      skipped++
      continue
    }

    const members = await tx
      .select()
      .from(expenseGroupMembers)
      .where(eq(expenseGroupMembers.groupId, expense.groupId))

    const memberMap = new Map(members.map((m) => [m.userId, m]))
    const sharedAccountIds = new Map<string, string>()

    for (const split of splits) {
      const member = memberMap.get(split.userId)
      const expenseAccountId = member?.defaultExpenseAccountId
        ?? await ensureUncategorizedAccount(split.userId, tx)

      if (!sharedAccountIds.has(split.userId)) {
        sharedAccountIds.set(split.userId, await ensureSharedAccount(split.userId, group, tx))
      }
      const sharedAccountId = sharedAccountIds.get(split.userId)!

      const txDate = new Date(`${expense.date}T00:00:00Z`)
      const [t] = await tx
        .insert(transactions)
        .values({
          userId: split.userId,
          date: txDate,
          description: expense.description,
          groupExpenseId: expense.id,
        })
        .returning()

      await tx.insert(postings).values([
        { transactionId: t.id, accountId: expenseAccountId, amount: (-parseFloat(split.amount)).toFixed(2), currency: expense.currency },
        { transactionId: t.id, accountId: sharedAccountId, amount: split.amount, currency: expense.currency },
      ])

      console.log(`  [OK] expense ${expense.id} user ${split.userId} → tx ${t.id}`)
    }

    // Link the expense to the payer's transaction (for reverse lookup from edit modal)
    const payerSplit = splits.find((s) => s.userId === expense.paidByUserId)
    if (payerSplit) {
      const [payerTx] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.groupExpenseId, expense.id), eq(transactions.userId, expense.paidByUserId)))
      if (payerTx) {
        await tx
          .update(groupExpenses)
          .set({ transactionId: payerTx.id })
          .where(eq(groupExpenses.id, expense.id))
      }
    }

    migrated++
  }
})

console.log(`\nDone. Migrated: ${migrated}, skipped: ${skipped}`)
process.exit(0)
