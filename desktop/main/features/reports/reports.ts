// What went to each category in a period: the money a spending report sums.

import { nameOf } from '@have-fish/core/account-path'
import { isCalendarDate } from '@have-fish/core/calendar-date'
import { format } from '@have-fish/core/money'
import { failure, type Outcome } from '@have-fish/core/outcome'
import { UNSORTED } from '@have-fish/core/own-accounts'
import { shapeOf } from '@have-fish/core/shapes'
import type Database from 'better-sqlite3'
import { and, between, eq, isNull, sql } from 'drizzle-orm'
import type { InputOf, Money, Values } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'
import { perConnection } from '../../db/prepared'
import { accounts, postings, transactions } from '../../db/schema'

const statements = perConnection((orm) => ({
  // Each live posting of a transaction in the period, together, so core can say its shape.
  postingsIn: orm
    .select({
      id: transactions.id,
      accountId: postings.accountId,
      kind: accounts.kind,
      path: accounts.path,
      pathKey: accounts.pathKey,
      cents: postings.amountCents,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(
      and(
        isNull(transactions.deletedAt),
        between(transactions.date, sql.placeholder('start'), sql.placeholder('end')),
      ),
    )
    .orderBy(transactions.date, transactions.id, postings.position)
    .prepare(),
}))

/**
 * Each spend's money in a category from `start` to `end`, both days in it, in the home currency.
 * Transfers between my accounts, income and starting balances go to no category, so they are not
 * spending. A spend paid in another currency counts what its account paid. What went out in other
 * currencies is summed apart, since it can't be added in yet.
 */
export function spendingIn(
  db: Database.Database,
  { start, end }: InputOf<'report.spending'>,
): Outcome<Values['report.spending']> {
  for (const date of [start, end]) {
    if (!isCalendarDate(date)) return failure('DATE_INVALID', { date })
  }
  if (end < start) return failure('DATE_INVALID', { date: end })

  const spent: Values['report.spending']['spent'] = []
  const other = new Map<string, number>()
  const byTransaction = Map.groupBy(statements(db).postingsIn.all({ start, end }), (p) => p.id)
  for (const [id, posted] of byTransaction) {
    const accountKinds = new Map(posted.map((p) => [p.accountId, p.kind]))
    const shape = shapeOf(posted, (accountId) => accountKinds.get(accountId))
    // A converted spend counts what its account paid, in the currency it paid in.
    const counted =
      shape.shape === 'converted'
        ? posted
            .filter((p) => p.accountId === shape.to.accountId)
            .map((p) => ({ ...p, cents: -shape.from.cents, currency: shape.from.currency }))
        : posted.filter((p) => p.kind === 'category')
    for (const leg of counted) {
      if (leg.currency !== HOME_CURRENCY) {
        other.set(leg.currency, (other.get(leg.currency) ?? 0) + leg.cents)
        continue
      }
      // A spend with no category reports as unsorted, `''`.
      const category = leg.pathKey === UNSORTED.path ? '' : nameOf(leg.path)
      spent.push({ id, category, amount: format(leg.cents) })
    }
  }
  const elsewhere: Money[] = [...other]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, cents]) => ({ amount: format(cents), currency }))
  return { ok: true, value: { currency: HOME_CURRENCY, spent, other: elsewhere } }
}
