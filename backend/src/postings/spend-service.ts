// What counts as spending, in one place.
//
// Every spending surface asks the same question of the same postings: the report totals, the
// category breakdown, the monthly trend, the FX pairs to convert, and the list of transactions
// beside them on the spending page. They used to ask it separately, and a list that selected by
// path root sat next to totals that selected by type — so once a tagged category at an
// atypical root reached the totals, the list beside them could not show the transaction that
// made it. This module is the answer both read from.

import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { db } from '../db'
import { accounts, postings, transactions } from '../db/schema'
import type { StoredAccountType } from './account-type'
import { typeFilterCondition, underPathCondition } from './account-type-sql'
import { type ClassifySettings, isExpenseSubject } from './roles'

const EXPENSE_TYPE = new Set<StoredAccountType>(['expense'])

export type SpendRow = {
  transactionId: string
  accountId: string
  path: string
  date: Date
  amount: string
  currency: string
}

/** The classifier's view of a fetched row. Its three fields, named the way it names them. */
function asRolePosting(row: { accountId: string; path: string; type: string | null }) {
  return { accountId: row.accountId, accountPath: row.path, accountType: row.type }
}

/**
 * The genuine spend legs in the period, with the mechanical legs of a cross-currency spend
 * already removed. `prefix` narrows to spend legs whose account is at or under that path.
 *
 * Selection is by RESOLVED account type — the account's own override, else its nearest tagged ancestor's, else what the path root infers
 * — not by `LIKE 'expenses:%'`. That was BUG-007's last hiding place: a category at an
 * atypically-named root, tagged Expense on its own settings page, matched no LIKE pattern, so
 * every spend into it was absent from the total, the breakdown and the trend, with no row to
 * notice was missing.
 *
 * The SQL is an over-inclusive prefilter and `isExpenseSubject` is the verdict — the same
 * split `GET /api/accounts/balances` uses. It has to be the real classifier: a fee-and-
 * conversion id set could stand in for it only while a LIKE guaranteed every row was an
 * expense leg. A clearing account someone has tagged Expense, say, reaches the prefilter, and
 * it is a `share` leg — a role an id set has no way to express.
 */
export async function spendRows(
  userId: string,
  settings: ClassifySettings,
  opts: { from?: Date; to?: Date; prefix?: string | null } = {},
): Promise<SpendRow[]> {
  const rows = await db
    .select({
      transactionId: postings.transactionId,
      accountId: postings.accountId,
      path: accounts.path,
      type: accounts.type,
      date: transactions.date,
      amount: postings.amount,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(accounts, eq(postings.accountId, accounts.id))
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(postings.deletedAt),
        isNull(accounts.deletedAt),
        typeFilterCondition(EXPENSE_TYPE, settings.roots),
        opts.prefix ? underPathCondition(opts.prefix) : undefined,
        opts.from ? gte(transactions.date, opts.from) : undefined,
        opts.to ? lte(transactions.date, opts.to) : undefined,
      ),
    )

  return rows
    .filter((r) => isExpenseSubject(asRolePosting(r), settings))
    .map(({ type: _prefilterInput, ...row }) => row)
}

/**
 * True when at least one of this user's accounts resolves to an expense at or under `prefix`.
 *
 * Guards the drill-down: `?prefix=assets:chequing` is a caller mistake, not an empty report.
 * Asked of the resolved type rather than of the configured expenses root, for the same reason
 * the rows are — a drill into a tagged category at an atypical root is a legitimate request,
 * and the root test refused it.
 */
export async function hasExpenseAccountUnder(
  userId: string,
  settings: ClassifySettings,
  prefix: string,
): Promise<boolean> {
  const candidates = await db
    .select({ accountId: accounts.id, path: accounts.path, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        isNull(accounts.deletedAt),
        typeFilterCondition(EXPENSE_TYPE, settings.roots),
        underPathCondition(prefix),
      ),
    )
  // A fee or conversion account is an expense account the reports never sum, so a prefix that
  // reaches only those is as empty as one that reaches none.
  return candidates.some((a) => isExpenseSubject(asRolePosting(a), settings))
}
