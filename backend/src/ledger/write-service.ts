import { and, eq, inArray, isNull } from 'drizzle-orm'
import { accountsOwnedBy } from '../accounts/ownership-service'
import { calendarDateOf } from '../calendar-date'
import { type DbTransaction, db, type Executor } from '../db'
import { returnedRow } from '../db/returning'
import { accounts, postings, transactions } from '../db/schema'
import { type ErrorBody, errorBody, type Outcome } from '../errors'
import { type PostingDraft, validatePostings } from './validate'

// The one place transactions and their postings are written. Every function here runs the
// same three steps in the same order:
//
//   1. `validatePostings`: count, currency, balance. Pure, so it fails before any query.
//   2. `accountsOwnedBy`: every account named belongs to the transaction's owner.
//   3. The writes, inside one database transaction, so a failure leaves nothing behind.
//
// A transaction and its postings are one sync document, versioned by the transaction's
// `updatedAt` (planning/epics/sync-unit.md). An update to the transaction row moves it by
// itself (`$onUpdate` in the schema); a change to postings alone does not, so every
// function here that changes postings moves it too, with `touch`. That's why no module
// outside `ledger/` may write a posting (`writers.test.ts`).
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
  /** `YYYY-MM-DD`, or an ISO timestamp whose date part is the day (`calendarDateOf`). */
  date: string
  description?: string | null | undefined
  postings: PostingDraft[]
}

/**
 * A transaction a unit of work writes. `id` lets the caller mint the id before the legs
 * are built, for builders that stamp it on each leg; `groupExpenseId` links a Fish Pie
 * member's transaction to its expense; `importFingerprint` records the bank row an import
 * came from (`import/fingerprint.ts`).
 */
export type LedgerDraft = TransactionDraft & {
  id?: string
  groupExpenseId?: string | null
  importFingerprint?: string
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
    const inserted = await insertPostings(tx, transactionId, drafts)
    const [touched] = await touch(tx, [transactionId])
    return { ...existing, ...touched, postings: inserted }
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

/**
 * Change a transaction's date or description. `PATCH /api/transactions/:id`.
 *
 * Only the transaction row changes, so its `updatedAt` moves by itself and there is nothing
 * to validate: the postings, and so the balance, are untouched.
 */
export async function updateTransactionDetails(
  userId: string,
  transactionId: string,
  details: { description?: string | null; date?: string },
): Promise<Outcome<TransactionRow>> {
  const [updated] = await db
    .update(transactions)
    .set(details)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    )
    .returning()
  if (!updated) return { ok: false, failure: errorBody('TRANSACTION_NOT_FOUND') }
  return { ok: true, value: updated }
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
  const added = await insertPostings(exec, transactionId, change.add)
  await touch(exec, [transactionId])
  return added
}

/**
 * Soft-delete transactions and their postings together, at `at`, inside the caller's unit
 * of work. Fish Pie retires a member's transactions this way when an expense is edited or
 * deleted, and a settlement's when it is deleted. Each transaction becomes a tombstone: the
 * update to its row moves its version. The caller has already established whose they are.
 */
export async function retireTransactions(
  exec: DbTransaction,
  transactionIds: string[],
  at: Date,
): Promise<void> {
  if (transactionIds.length === 0) return
  await exec
    .update(transactions)
    .set({ deletedAt: at })
    .where(inArray(transactions.id, transactionIds))
  await exec
    .update(postings)
    .set({ deletedAt: at })
    .where(inArray(postings.transactionId, transactionIds))
}

/**
 * Move individual postings of `ownerId`'s transactions to other accounts, amounts
 * untouched, so every transaction still balances. Heal uses this to route a malformed FX
 * spend through the conversion account. The new accounts must be the owner's.
 */
export async function repointPostings(
  exec: DbTransaction,
  ownerId: string,
  moves: { postingId: string; toAccountId: string }[],
): Promise<void> {
  const owned = await accountsOwnedBy(
    ownerId,
    moves.map((m) => m.toAccountId),
    { executor: exec, includeDeleted: true },
  )
  if (!owned) throw new Refused(errorBody('ACCOUNTS_NOT_FOUND'))

  const changed = new Set<string>()
  for (const move of moves) {
    const rows = await exec
      .update(postings)
      .set({ accountId: move.toAccountId })
      .where(eq(postings.id, move.postingId))
      .returning({ transactionId: postings.transactionId })
    for (const r of rows) changed.add(r.transactionId)
  }
  await touch(exec, [...changed])
}

/**
 * Move every posting, deleted or not, from one account to another of the same owner. The
 * Fish Pie group merge folds each member's old clearing accounts into their new one this
 * way. Every transaction with a leg moved gets a new version.
 */
export async function moveAccountPostings(
  exec: DbTransaction,
  fromAccountId: string,
  toAccountId: string,
): Promise<void> {
  const owners = await exec
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(inArray(accounts.id, [fromAccountId, toAccountId]))
  if (owners.length !== 2 || owners[0]?.userId !== owners[1]?.userId) {
    // Not a refusal a request can cause: the merge pairs each member's accounts itself.
    throw new Error('moveAccountPostings: the two accounts must exist and share an owner')
  }

  const rows = await exec
    .update(postings)
    .set({ accountId: toAccountId })
    .where(eq(postings.accountId, fromAccountId))
    .returning({ transactionId: postings.transactionId })
  await touch(exec, [...new Set(rows.map((r) => r.transactionId))])
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
        date: calendarDateOf(draft.date),
        description: draft.description ?? null,
        ...(draft.groupExpenseId ? { groupExpenseId: draft.groupExpenseId } : {}),
        ...(draft.importFingerprint ? { importFingerprint: draft.importFingerprint } : {}),
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

// Move the version of transactions whose postings changed without their own row changing.
function touch(exec: Executor, transactionIds: string[]): Promise<TransactionRow[]> {
  if (transactionIds.length === 0) return Promise.resolve([])
  return exec
    .update(transactions)
    .set({ updatedAt: new Date() })
    .where(inArray(transactions.id, transactionIds))
    .returning()
}

function accountIdsOf(drafts: PostingDraft[]): string[] {
  return drafts.map((p) => p.accountId)
}
