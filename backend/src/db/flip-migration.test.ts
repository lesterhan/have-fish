import { describe, it, expect, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql, eq } from 'drizzle-orm'
import { app } from '../app'
import { clearDatabase, createTestUser } from '../test-utils'
import { db } from '../db'
import { transactions, postings, accounts, groupExpenses } from './schema'

// Migration 0029 flips the postings of active non-payer member transactions
// (BUG-005). The drizzle journal runs it exactly once at deploy time; this test
// seeds pre-fix data by hand and executes the same SQL to prove the discriminator
// flips exactly the debtor rows and nothing else.
const migrationSql = readFileSync(
  join(import.meta.dir, '../../drizzle/0029_flip_nonpayer_member_tx_postings.sql'),
  'utf8',
)

describe('migration 0029 — flip non-payer member tx postings', () => {
  let userAId: string
  let userBId: string
  let groupId: string

  beforeEach(async () => {
    await clearDatabase()
    const cookieA = await createTestUser('a@test.com', 'passwordA')
    const cookieB = await createTestUser('b@test.com', 'passwordB')

    const sessionA = await app.request('/api/auth/get-session', { headers: { Cookie: cookieA } })
    userAId = ((await sessionA.json()) as any).user.id
    const sessionB = await app.request('/api/auth/get-session', { headers: { Cookie: cookieB } })
    userBId = ((await sessionB.json()) as any).user.id

    const groupRes = await app.request('/api/fish-pie/groups', {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trip' }),
    })
    groupId = ((await groupRes.json()) as any).id
  })

  async function insertAccount(userId: string, path: string) {
    const [acct] = await db.insert(accounts).values({ userId, path, name: path }).returning()
    return acct
  }

  async function postingAmounts(txId: string): Promise<Record<string, string>> {
    const rows = await db.select().from(postings).where(eq(postings.transactionId, txId))
    return Object.fromEntries(rows.map((p) => [p.accountId, p.amount]))
  }

  it('flips exactly the active non-payer member transactions', async () => {
    const visaA = await insertAccount(userAId, 'liabilities:visa')
    const foodA = await insertAccount(userAId, 'expenses:food')
    const clearingA = await insertAccount(userAId, 'group:trip-manual')
    const foodB = await insertAccount(userBId, 'expenses:food')
    const clearingB = await insertAccount(userBId, 'group:trip-manual')
    const chequingB = await insertAccount(userBId, 'assets:chequing')

    const txDate = new Date('2026-05-01T00:00:00Z')

    // Expense paid by A — pre-fix posting shapes inserted by hand.
    const [expense] = await db
      .insert(groupExpenses)
      .values({ groupId, paidByUserId: userAId, description: 'Dinner', amount: '100.00', currency: 'CAD', date: '2026-05-01' })
      .returning()

    // 1. B's member tx, old (inverted) signs → MUST flip
    const [debtorTx] = await db
      .insert(transactions)
      .values({ userId: userBId, date: txDate, description: 'Dinner', groupExpenseId: expense.id })
      .returning()
    await db.insert(postings).values([
      { transactionId: debtorTx.id, accountId: foodB.id, amount: '-50.00', currency: 'CAD' },
      { transactionId: debtorTx.id, accountId: clearingB.id, amount: '50.00', currency: 'CAD' },
    ])

    // 2. A's payer 3-posting tx → untouched (userId = paidByUserId)
    const [payerTx] = await db
      .insert(transactions)
      .values({ userId: userAId, date: txDate, description: 'Dinner', groupExpenseId: expense.id })
      .returning()
    await db.insert(postings).values([
      { transactionId: payerTx.id, accountId: visaA.id, amount: '-100.00', currency: 'CAD' },
      { transactionId: payerTx.id, accountId: clearingA.id, amount: '50.00', currency: 'CAD' },
      { transactionId: payerTx.id, accountId: foodA.id, amount: '50.00', currency: 'CAD' },
    ])

    // 3. Soft-deleted tx of a FORMER payer (payer later edited from B to A):
    //    userId != paidByUserId but deleted → untouched
    const [stalePayerTx] = await db
      .insert(transactions)
      .values({ userId: userBId, date: txDate, description: 'Dinner (old payer)', groupExpenseId: expense.id, deletedAt: new Date() })
      .returning()
    await db.insert(postings).values([
      { transactionId: stalePayerTx.id, accountId: chequingB.id, amount: '-100.00', currency: 'CAD', deletedAt: new Date() },
      { transactionId: stalePayerTx.id, accountId: clearingB.id, amount: '50.00', currency: 'CAD', deletedAt: new Date() },
      { transactionId: stalePayerTx.id, accountId: foodB.id, amount: '50.00', currency: 'CAD', deletedAt: new Date() },
    ])

    // 4. Settlement-style tx (no groupExpenseId) → untouched
    const [settlementTx] = await db
      .insert(transactions)
      .values({ userId: userBId, date: txDate, description: 'Settlement to Trip' })
      .returning()
    await db.insert(postings).values([
      { transactionId: settlementTx.id, accountId: chequingB.id, amount: '-50.00', currency: 'CAD' },
      { transactionId: settlementTx.id, accountId: clearingB.id, amount: '50.00', currency: 'CAD' },
    ])

    await db.execute(sql.raw(migrationSql))

    // Debtor tx flipped
    const debtor = await postingAmounts(debtorTx.id)
    expect(debtor[foodB.id]).toBe('50.00')
    expect(debtor[clearingB.id]).toBe('-50.00')

    // Payer tx unchanged
    const payer = await postingAmounts(payerTx.id)
    expect(payer[visaA.id]).toBe('-100.00')
    expect(payer[clearingA.id]).toBe('50.00')
    expect(payer[foodA.id]).toBe('50.00')

    // Soft-deleted former-payer tx unchanged
    const stale = await postingAmounts(stalePayerTx.id)
    expect(stale[chequingB.id]).toBe('-100.00')
    expect(stale[clearingB.id]).toBe('50.00')
    expect(stale[foodB.id]).toBe('50.00')

    // Settlement tx unchanged
    const settlement = await postingAmounts(settlementTx.id)
    expect(settlement[chequingB.id]).toBe('-50.00')
    expect(settlement[clearingB.id]).toBe('50.00')
  })
})
