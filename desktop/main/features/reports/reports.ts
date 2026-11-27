// What went to each category in a period: the money a spending report sums.

import type { AccountKind } from '@have-fish/core/account-kind'
import { nameOf } from '@have-fish/core/account-path'
import { isCalendarDate } from '@have-fish/core/calendar-date'
import { format } from '@have-fish/core/money'
import { failure, type Outcome } from '@have-fish/core/outcome'
import { UNSORTED } from '@have-fish/core/own-accounts'
import { type Pools, poolsOf } from '@have-fish/core/pool'
import { type Mark, type RateBook, rateBookOf, rateFor } from '@have-fish/core/rate-for'
import { convert, significant } from '@have-fish/core/rates'
import { type ShapeLeg, shapeOf } from '@have-fish/core/shapes'
import type Database from 'better-sqlite3'
import { and, between, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Guess, InputOf, Values } from '../../../shared/commands'
import { HOME_CURRENCY, type Money } from '../../../shared/currency'
import { perConnection } from '../../db/prepared'
import { accounts, postings, rates, transactions } from '../../db/schema'
import { rateOf } from '../../ledger/rows'

const statements = perConnection((orm, db) => ({
  // Each live posting of a transaction in the period, together, so core can say its shape.
  postingsIn: orm
    .select({
      id: transactions.id,
      date: transactions.date,
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
  // Each live posting of every transaction that holds one in another currency: what each currency
  // I hold cost me, since euros bought with dollars carry what the dollars cost.
  history: orm
    .select({
      id: transactions.id,
      date: transactions.date,
      accountId: postings.accountId,
      kind: accounts.kind,
      cents: postings.amountCents,
      currency: postings.currency,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(
          transactions.id,
          orm
            .select({ id: postings.transactionId })
            .from(postings)
            .where(ne(postings.currency, HOME_CURRENCY)),
        ),
      ),
    )
    .orderBy(transactions.date, transactions.id, postings.position)
    .prepare(),
  // Every rate the ledger holds: the one I typed or fetched, by day, for a spend with no cost.
  rates: orm.select().from(rates).where(isNull(rates.deletedAt)).prepare(),
  // How many rows this connection has changed: any write moves it, so a reading can't outlive one.
  changes: db.prepare<[], { changes: number }>('SELECT total_changes() AS changes'),
}))

/** What a currency I hold cost me, and the rates beside it: how a spend converts. */
type Reading = { pools: Pools; book: RateBook }

/** One spend's money in the home currency, and how good the rate it took is. */
type Amount = {
  amount: string
  mark: Mark
  /** Why the rate is a guess: for a borrowed or missing one, and no other. */
  guess?: Guess
  /** Its own amount, for a missing one, and no other. */
  uncounted?: Money
}

/** The reading in hand for a connection, and the write count it was made at. */
const kept = new WeakMap<Database.Database, { changes: number; reading: Reading }>()

/**
 * Each spend's money in a category from `start` to `end`, both days in it, in the home currency.
 * Transfers between my accounts, income and starting balances go to no category, so they are not
 * spending. A spend in another currency counts what it cost me, at the best rate there is, and
 * says how good that rate is; one with none counts nothing, marked `missing`.
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
  /** The reading this call is using, asked for once, by the first spend in another currency. */
  let reading: Reading | null = null
  /** A leg's money in the home currency, and how good the rate it took there is. */
  const amountOf = (leg: { cents: number; currency: string; date: string }): Amount => {
    if (leg.currency === HOME_CURRENCY) return { amount: format(leg.cents), mark: 'exact' }
    reading ??= readingIn(db)
    const { pools, book } = reading
    const rate = rateFor(
      { currency: leg.currency, date: leg.date, own: null },
      pools,
      book,
      HOME_CURRENCY,
    )
    // A spend with no rate at all adds nothing to the sums it is in.
    if (rate.mark === 'missing') {
      const guess = { date: leg.date, currency: leg.currency, from: null }
      return {
        amount: format(0),
        mark: rate.mark,
        guess,
        uncounted: { amount: format(leg.cents), currency: leg.currency },
      }
    }
    const amount = format(convert(leg.cents, rate.rate))
    if (rate.mark === 'borrowed') {
      const from = { date: rate.day, rate: significant(rate.rate, 4) }
      return { amount, mark: rate.mark, guess: { date: leg.date, currency: leg.currency, from } }
    }
    return { amount, mark: rate.mark }
  }

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
      // A spend with no category reports as unsorted, `''`.
      const category = leg.pathKey === UNSORTED.path ? '' : nameOf(leg.path)
      spent.push({ id, category, ...amountOf(leg) })
    }
  }
  return { ok: true, value: { currency: HOME_CURRENCY, spent } }
}

/**
 * The pool and the book for `db`: the reading in hand while no write has moved the ledger since it
 * was made, else one read from the whole ledger, which every week then shares.
 */
function readingIn(db: Database.Database): Reading {
  const found = statements(db)
  const changes = found.changes.get()?.changes ?? 0
  const inHand = kept.get(db)
  if (inHand !== undefined && inHand.changes === changes) return inHand.reading
  const reading = readingOf(found)
  kept.set(db, { changes, reading })
  return reading
}

/** The pool and the book of every currency, from the whole ledger. */
function readingOf(found: ReturnType<typeof statements>): Reading {
  const kindByAccount = new Map<string, AccountKind>()
  const byTransaction = new Map<string, { date: string; legs: ShapeLeg[] }>()
  for (const row of found.history.all()) {
    kindByAccount.set(row.accountId, row.kind)
    const leg = { accountId: row.accountId, cents: row.cents, currency: row.currency }
    const group = byTransaction.get(row.id)
    if (group === undefined) byTransaction.set(row.id, { date: row.date, legs: [leg] })
    else group.legs.push(leg)
  }
  const docs = found.rates.all().map((row) => rateOf(row).doc)
  const kindOf = (accountId: string) => kindByAccount.get(accountId)
  return {
    pools: poolsOf([...byTransaction.values()], kindOf, HOME_CURRENCY),
    book: rateBookOf(docs, HOME_CURRENCY),
  }
}
