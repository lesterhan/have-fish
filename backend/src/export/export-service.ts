import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import { db } from '../db'
import { accounts, postings, transactions } from '../db/schema'
import { resolveStoredOrInferredType } from '../postings/account-type'
import { loadAccountTypeContext } from '../postings/classify-service'
import type { JournalAccount, JournalData, JournalPosting } from './journal'

/** Inclusive calendar-date bounds on the transactions exported; either may be absent. */
export type ExportRange = { from?: string | undefined; to?: string | undefined }

/**
 * One user's ledger in the shape `serializeJournal` takes: every live transaction in the
 * range with its live postings, and every account, typed as the rest of the app types it.
 *
 * Accounts are declared whatever the range, since they are data in their own right. A
 * deleted account is declared only when an exported posting still names it, which the app
 * refuses to create (`ACCOUNT_HAS_ENTRIES`) but older rows may hold; leaving it out would
 * fail hledger's strict check rather than the balance.
 */
export async function loadJournal(userId: string, range: ExportRange = {}): Promise<JournalData> {
  const inRange = and(
    eq(transactions.userId, userId),
    isNull(transactions.deletedAt),
    range.from ? gte(transactions.date, range.from) : undefined,
    range.to ? lte(transactions.date, range.to) : undefined,
  )

  const [txRows, postingRows, accountRows, ctx] = await Promise.all([
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
      })
      .from(transactions)
      .where(inRange)
      // Within a day, the order they were entered, so the file reads as the ledger does.
      .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id)),
    db
      .select({
        transactionId: postings.transactionId,
        accountId: postings.accountId,
        amount: postings.amount,
        currency: postings.currency,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(inRange, isNull(postings.deletedAt)))
      // Postings written together share a `createdAt`, and nothing records the order they
      // were entered in. By currency and then amount, money leaving comes before money
      // arriving, and a conversion reads -CAD, +CAD, -EUR, +EUR, as a person would write it.
      .orderBy(
        asc(postings.createdAt),
        asc(postings.currency),
        asc(postings.amount),
        asc(postings.id),
      ),
    db
      .select({
        id: accounts.id,
        path: accounts.path,
        type: accounts.type,
        deletedAt: accounts.deletedAt,
      })
      .from(accounts)
      .where(eq(accounts.userId, userId)),
    loadAccountTypeContext(userId),
  ])

  const accountById = new Map(accountRows.map((a) => [a.id, a]))
  const named = new Set<string>()
  const legs = new Map<string, JournalPosting[]>()
  for (const p of postingRows) {
    const account = accountById.get(p.accountId)
    // A posting's account is the user's own: the write path checks it (refuseUnlessOwned).
    if (!account) throw new Error(`posting names account ${p.accountId}, which is not the user's`)
    named.add(account.id)
    const list = legs.get(p.transactionId) ?? []
    legs.set(p.transactionId, list)
    list.push({ accountPath: account.path, amount: p.amount, currency: p.currency })
  }

  const declared: JournalAccount[] = accountRows
    .filter((a) => a.deletedAt === null || named.has(a.id))
    .map((a) => ({ path: a.path, type: resolveStoredOrInferredType(a, ctx) }))

  return {
    accounts: declared,
    transactions: txRows.map((t) => ({
      date: t.date,
      description: t.description,
      postings: legs.get(t.id) ?? [],
    })),
  }
}
