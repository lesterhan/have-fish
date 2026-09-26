import { and, eq, inArray, isNull } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { type DbTransaction, db, type Executor } from '../db'
import { returnedRow } from '../db/returning'
import { postings, transactions } from '../db/schema'
import { type ErrorBody, errorBody, type Outcome } from '../errors'
import { type PostingDraft, validatePostings } from './validate'

// The one place transactions and their postings are written. Every function here runs the
// same three steps in the same order:
//
//   1. `validatePostings`: count, currency, balance. Pure, so it fails before any query.
//   2. `accountsOwnedBy`: every account named belongs to the transaction's owner.
//   3. The writes, inside one database transaction, so a failure leaves nothing behind.
//
// There are two ways in.
//
// - **A whole request** (`createTransaction`, `createTransactions`, `replacePostings`):
//   the service opens the database transaction itself, and steps 1 and 2 run before it
//   does. A refusal is an `Outcome`.
// - **A step in a larger unit of work** (`writeTransaction`, `amendPostings`): import and
//   Fish Pie build the legs themselves, inside a database transaction that also writes
//   group expenses, settlements and clearing accounts. They run inside
//   `inLedgerTransaction`, which opens that transaction. A refusal from any write inside it
//   rolls the whole unit back and comes out as an `Outcome` too, so no route sees a throw.

/** A transaction as a caller proposes it. */
export type TransactionDraft = {
  date: string | Date
  description?: string | null | undefined
  postings: PostingDraft[]
}

/**
 * A transaction a unit of work writes. `id` lets the caller mint the id before the legs
 * are built, for builders that stamp it on each leg; `groupExpenseId` links a Fish Pie
 * member's transaction to its expense.
 */
export type LedgerDraft = TransactionDraft & {
  id?: string
  groupExpenseId?: string | null
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

// --- Inside a larger unit of work -------------------------------------------------------

// Carries a refusal out of the database transaction, which rolls it back. Private: only
// `inLedgerTransaction` catches it, and turns it back into an `Outcome`.
class Refused extends Error {
  constructor(readonly failure: ErrorBody) {
    super(`ledger write refused: ${failure.error}`)
  }
}

/**
 * Open a database transaction for a unit of work that writes through `writeTransaction` or
 * `amendPostings`. If any of those writes is refused, everything the unit wrote rolls back
 * and the refusal is the answer; any other error propagates as before.
 */
export async function inLedgerTransaction<T>(
  work: (tx: DbTransaction) => Promise<T>,
): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await db.transaction(work) }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, failure: e.failure }
    throw e
  }
}

/**
 * Write one transaction owned by `ownerId` inside the caller's unit of work. The legs were
 * built by code rather than sent by a request, but they get the same validation. Their
 * accounts must belong to the owner, deleted or not: Fish Pie builds legs from each
 * member's stored defaults, and whether those are still active is a separate question.
 *
 * `index` is the row's position when the unit writes a batch (import), carried into a
 * refusal so the client can say which row.
 */
export async function writeTransaction(
  exec: DbTransaction,
  ownerId: string,
  draft: LedgerDraft,
  options: { index?: number } = {},
): Promise<WrittenTransaction> {
  refuseUnless(validatePostings(draft.postings, options.index))
  await refuseUnlessOwned(exec, ownerId, draft.postings)
  return insertTransaction(exec, ownerId, draft)
}

/**
 * Change some legs of an existing transaction inside the caller's unit of work: soft-delete
 * the `retire`d postings (at `at`), add the new ones, and refuse unless the transaction's
 * postings still validate as a whole afterwards. Fish Pie uses this when an expense edit
 * rebalances the payer's import transaction; unlike `replacePostings`, the retired legs are
 * kept as soft-deleted rows, as Fish Pie has always kept them.
 */
export async function amendPostings(
  exec: DbTransaction,
  transactionId: string,
  change: { retire: string[]; add: PostingDraft[]; at: Date },
): Promise<PostingRow[]> {
  // The owner is read from the transaction rather than taken from the caller, so a leg can
  // only ever be added in an account of the person whose transaction it is.
  const owner = returnedRow(
    await exec
      .select({ userId: transactions.userId })
      .from(transactions)
      .where(eq(transactions.id, transactionId)),
    'select transactions for amendPostings',
  )
  const retiring = new Set(change.retire)
  const kept = await exec
    .select({
      id: postings.id,
      accountId: postings.accountId,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .where(and(eq(postings.transactionId, transactionId), isNull(postings.deletedAt)))
  const result = [...kept.filter((p) => !retiring.has(p.id)), ...change.add]

  refuseUnless(validatePostings(result))
  await refuseUnlessOwned(exec, owner.userId, change.add)

  if (change.retire.length > 0) {
    await exec
      .update(postings)
      .set({ deletedAt: change.at })
      .where(and(eq(postings.transactionId, transactionId), inArray(postings.id, change.retire)))
  }
  return insertPostings(exec, transactionId, change.add)
}

function refuseUnless(outcome: Outcome<void>): void {
  if (!outcome.ok) throw new Refused(outcome.failure)
}

async function refuseUnlessOwned(exec: Executor, ownerId: string, drafts: PostingDraft[]) {
  const owned = await accountsOwnedBy(ownerId, accountIdsOf(drafts), {
    executor: exec,
    includeDeleted: true,
  })
  if (!owned) throw new Refused(errorBody('ACCOUNTS_NOT_FOUND'))
}

// The writes themselves, on whatever executor the caller holds. They assume steps 1 and 2
// already passed, which is why they aren't exported.
async function insertTransaction(
  exec: Executor,
  userId: string,
  draft: LedgerDraft,
): Promise<WrittenTransaction> {
  const row = returnedRow(
    await exec
      .insert(transactions)
      .values({
        ...(draft.id ? { id: draft.id } : {}),
        userId,
        date: new Date(draft.date),
        description: draft.description ?? null,
        ...(draft.groupExpenseId ? { groupExpenseId: draft.groupExpenseId } : {}),
      })
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
