import { and, eq, isNull } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { db, type Executor } from '../db'
import { returnedRow } from '../db/returning'
import { postings, transactions } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import { type PostingDraft, validatePostings } from './validate'

// The one place a personal transaction and its postings are written. Every function here
// runs the same three steps in the same order:
//
//   1. `validatePostings`: count, currency, balance. Pure, so it fails before any query.
//   2. `accountsOwnedBy`: every account named is the caller's own and active.
//   3. The writes, inside one database transaction, so a failure leaves nothing behind.
//
// Steps 1 and 2 are the rules a caller can break, and they come back as an `Outcome`.
// Step 3 only throws if the database does.

/** A transaction as a caller proposes it. */
export type TransactionDraft = {
  date: string
  description?: string | null | undefined
  postings: PostingDraft[]
}

type TransactionRow = typeof transactions.$inferSelect
type PostingRow = typeof postings.$inferSelect

/** A transaction as written, with the posting rows the insert returned. */
export type WrittenTransaction = TransactionRow & { postings: PostingRow[] }

/** Create one transaction. `POST /api/transactions`. */
export async function createTransaction(
  userId: string,
  draft: TransactionDraft,
): Promise<Outcome<WrittenTransaction>> {
  const valid = validatePostings(draft.postings)
  if (!valid.ok) return valid

  if (!(await accountsOwnedBy(userId, accountIdsOf(draft.postings)))) {
    return { ok: false, failure: errorBody('ACCOUNTS_NOT_FOUND') }
  }

  const written = await db.transaction((tx) => insertTransaction(tx, userId, draft))
  return { ok: true, value: written }
}

/**
 * Create several transactions, all or none. `POST /api/transactions/bulk`. Every entry is
 * validated, with its index, before any account is looked up, and every account across
 * the batch is checked in one query.
 */
export async function createTransactions(
  userId: string,
  drafts: TransactionDraft[],
): Promise<Outcome<WrittenTransaction[]>> {
  for (const [i, draft] of drafts.entries()) {
    const valid = validatePostings(draft.postings, i)
    if (!valid.ok) return valid
  }

  if (
    !(await accountsOwnedBy(
      userId,
      drafts.flatMap((d) => accountIdsOf(d.postings)),
    ))
  ) {
    return { ok: false, failure: errorBody('ACCOUNTS_NOT_FOUND') }
  }

  const written = await db.transaction(async (tx) => {
    const results: WrittenTransaction[] = []
    for (const draft of drafts) results.push(await insertTransaction(tx, userId, draft))
    return results
  })
  return { ok: true, value: written }
}

/**
 * Replace every posting of one of the caller's transactions. `POST
 * /api/transactions/:id/postings`. The old postings are hard-deleted and the new ones get
 * new ids: a transaction's legs are replaced as a set, never patched one by one, which is
 * what keeps the balance check meaningful.
 */
export async function replacePostings(
  userId: string,
  transactionId: string,
  drafts: PostingDraft[],
): Promise<Outcome<WrittenTransaction>> {
  const valid = validatePostings(drafts)
  if (!valid.ok) return valid

  const [existing] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    )
  if (!existing) return { ok: false, failure: errorBody('TRANSACTION_NOT_FOUND') }

  if (!(await accountsOwnedBy(userId, accountIdsOf(drafts)))) {
    return { ok: false, failure: errorBody('ACCOUNTS_NOT_FOUND') }
  }

  const written = await db.transaction(async (tx) => {
    await tx.delete(postings).where(eq(postings.transactionId, transactionId))
    return { ...existing, postings: await insertPostings(tx, transactionId, drafts) }
  })
  return { ok: true, value: written }
}

/**
 * Soft-delete one of the caller's transactions and hard-delete its postings. The
 * transaction row, with `deletedAt` set, is the record that it existed; postings mean
 * nothing without it, so they get no tombstone.
 *
 * The soft-delete is the ownership check: it runs first, and the postings go only if it
 * matched an active transaction of the caller's. There's no failure to report. Deleting
 * what is already gone, or never was the caller's, writes nothing, and the route answers
 * the same either way.
 */
export async function deleteTransaction(userId: string, transactionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning({ id: transactions.id })
    if (deleted.length === 0) return
    await tx.delete(postings).where(eq(postings.transactionId, transactionId))
  })
}

// The writes themselves, on whatever executor the caller holds. They assume steps 1 and 2
// already passed, which is why they aren't exported.
async function insertTransaction(
  exec: Executor,
  userId: string,
  draft: TransactionDraft,
): Promise<WrittenTransaction> {
  const row = returnedRow(
    await exec
      .insert(transactions)
      .values({ userId, date: new Date(draft.date), description: draft.description ?? null })
      .returning(),
    'insert transactions',
  )
  return { ...row, postings: await insertPostings(exec, row.id, draft.postings) }
}

async function insertPostings(
  exec: Executor,
  transactionId: string,
  drafts: PostingDraft[],
): Promise<PostingRow[]> {
  return exec
    .insert(postings)
    .values(
      drafts.map((p) => ({
        transactionId,
        accountId: p.accountId,
        amount: p.amount,
        currency: p.currency,
      })),
    )
    .returning()
}

function accountIdsOf(drafts: PostingDraft[]): string[] {
  return drafts.map((p) => p.accountId)
}
