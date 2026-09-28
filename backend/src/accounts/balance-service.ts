// What each account holds: the balances view, one account's balance as of a date, and how
// many entries each account has. Reads only.

import { and, count, eq, isNull, lte, not, or, type SQL, sql } from 'drizzle-orm'
import { db } from '../db'
import { accounts, postings, transactions } from '../db/schema'
import { errorBody, type Outcome } from '../errors'
import {
  type AccountTypeContext,
  isStoredAccountType,
  resolveStoredOrInferredType,
  type StoredAccountType,
} from '../postings/account-type'
import {
  noUsableOverrideCondition,
  required,
  typeFilterCondition,
  underAnyTypeSourceCondition,
} from '../postings/account-type-sql'
import { loadAccountTypeContext } from '../postings/classify-service'
import {
  BALANCE_BEARING_TYPES,
  type BalanceSelection,
  type CurrencyBalance,
  selects,
  sumByCurrency,
} from './balances'
import { accountsOwnedBy } from './ownership-service'

/** One account on the balances view. */
export type AccountBalances = {
  id: string
  path: string
  name: string | null
  /** The raw stored override, as on `GET /api/accounts`. */
  type: StoredAccountType | null
  /** The effective type: own override, else a tagged ancestor's, else the root's. */
  resolvedType: StoredAccountType | null
  /** The account's own currency. A cash wallet holds exactly one, and the
   *  Companion reads this rather than guessing from the path leaf. */
  defaultCurrency: string | null
  balances: CurrencyBalance[]
}

// The SQL prefilter for a selection. It may be over-inclusive; `selects` is the verdict.
//
// Resolved, not path-inferred: a wallet at `储蓄:现金` tagged Cash is money you hold, and
// selecting by path root alone left it on no balances surface at all — visible only to a
// caller that passed `?types=cash`, which is the one query the bug report could not make from
// the UI. The stored override is the account's answer about itself; a view that asks the path
// instead is asking the wrong source.
function selectionCondition(selection: BalanceSelection, ctx: AccountTypeContext): SQL {
  if (selection.kind === 'types') return typeFilterCondition(selection.types, ctx)

  const balanceBearing = typeFilterCondition(BALANCE_BEARING_TYPES, ctx)
  if (!selection.includeUnfiled) return balanceBearing

  // Unfiled is what it always meant: the app has no answer for this account. No usable
  // override, no tagged ancestor to inherit one from, and no configured root to infer one
  // from. A path that *is* tagged, or sits under one that is, is whatever that says.
  const unfiled = required(
    and(noUsableOverrideCondition(), not(underAnyTypeSourceCondition(ctx))),
    'unfiled',
  )
  return required(or(balanceBearing, unfiled), 'balance-bearing selection')
}

/**
 * Every active account the selection picks, with its per-currency balance: the sum of its
 * live postings. An account with no postings is included with an empty `balances`.
 * Membership is by RESOLVED type, so an account is here because of what it says it is, not
 * because of where it sits.
 */
export async function accountBalances(
  userId: string,
  selection: BalanceSelection,
): Promise<AccountBalances[]> {
  const ctx = await loadAccountTypeContext(userId)
  const where = and(
    eq(accounts.userId, userId),
    isNull(accounts.deletedAt),
    selectionCondition(selection, ctx),
  )
  const rows = await db
    .select({
      id: accounts.id,
      path: accounts.path,
      name: accounts.name,
      storedType: accounts.type,
      defaultCurrency: accounts.defaultCurrency,
    })
    .from(accounts)
    .where(where)
  // The amounts themselves, joined to the same selection so no id list is sent.
  const amounts = await db
    .select({ accountId: postings.accountId, currency: postings.currency, amount: postings.amount })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(isNull(postings.deletedAt), where))

  const byAccount = new Map<string, { currency: string; amount: string }[]>()
  for (const a of amounts) {
    const list = byAccount.get(a.accountId) ?? []
    byAccount.set(a.accountId, list)
    list.push(a)
  }

  const out: AccountBalances[] = []
  for (const row of rows) {
    const resolvedType = resolveStoredOrInferredType({ path: row.path, type: row.storedType }, ctx)
    if (!selects(selection, resolvedType)) continue
    out.push({
      id: row.id,
      path: row.path,
      name: row.name,
      type: isStoredAccountType(row.storedType) ? row.storedType : null,
      resolvedType,
      defaultCurrency: row.defaultCurrency,
      balances: sumByCurrency(byAccount.get(row.id) ?? []),
    })
  }
  return out
}

/** One account's entry count and the date of its latest one. */
export type PostingCount = { accountId: string; count: number; lastActivity: string | null }

/**
 * One row for every active account, including those never posted to (count 0,
 * lastActivity null). Counts only live postings on live transactions.
 *
 * `lastActivity` is a plain `YYYY-MM-DD`, matching `GET /api/catch-up`: callers render
 * staleness in days, and a timestamp would only invite time-zone drift.
 */
export async function postingCounts(userId: string): Promise<PostingCount[]> {
  // Left joins, so an account with no activity still gets a row. Both deletedAt filters sit in
  // the ON clauses rather than the WHERE — in the WHERE they would drop the unmatched rows and
  // collapse this back to an inner join. COUNT over transactions.id (not *) then counts only
  // the rows that actually joined, so a posting on a soft-deleted transaction is excluded.
  return db
    .select({
      accountId: accounts.id,
      count: count(transactions.id),
      lastActivity: sql<string | null>`MAX(${transactions.date})`,
    })
    .from(accounts)
    .leftJoin(postings, and(eq(postings.accountId, accounts.id), isNull(postings.deletedAt)))
    .leftJoin(
      transactions,
      and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt)),
    )
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)))
    .groupBy(accounts.id)
}

/**
 * One account's balance at the end of `date`, inclusive: the sum of its live postings on
 * live transactions dated on or before it, per currency.
 */
export async function balanceAsOf(
  userId: string,
  accountId: string,
  date: string,
): Promise<Outcome<{ accountId: string; date: string; balances: CurrencyBalance[] }>> {
  if (!(await accountsOwnedBy(userId, [accountId]))) {
    return { ok: false, failure: errorBody('ACCOUNT_NOT_FOUND') }
  }

  const rows = await db
    .select({ currency: postings.currency, amount: postings.amount })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(
      and(
        eq(postings.accountId, accountId),
        isNull(postings.deletedAt),
        isNull(transactions.deletedAt),
        lte(transactions.date, date),
      ),
    )

  return { ok: true, value: { accountId, date, balances: sumByCurrency(rows) } }
}
