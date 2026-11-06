// The ledger's list, a page at a time: newest day first, and newest made first within a day. The
// window holds the pages around its view and never the whole list (see #608).

import { type AccountKind, isAddable } from '@have-fish/core/account-kind'
import { nameOf } from '@have-fish/core/account-path'
import { format } from '@have-fish/core/money'
import { type Leg, simpleAmountOf } from '@have-fish/core/postings'
import type Database from 'better-sqlite3'
import type {
  DayNet,
  InputOf,
  ListedDay,
  ListedTransaction,
  Money,
  Values,
} from '../../shared/commands'
import { perConnection } from '../db/prepared'
import { INCOME, sendable } from './spends'

type Head = { id: string; date: string; description: string }
type Key = { date: string; originCreatedAt: number; version: string; id: string }
type Row = { transactionId: string; position: number; currency: string; cents: number } & {
  path: string | null
  kind: AccountKind | null
}

// The list's order is newest first; `transactions_listed` holds it, read backwards.
const statements = perConnection((_, db) => ({
  total: db
    .prepare<[], number>(`SELECT count(*) FROM transactions WHERE deletedAt IS NULL`)
    .pluck(),
  page: db.prepare<{ from: number; limit: number }, Head>(
    `SELECT id, date, description FROM transactions WHERE deletedAt IS NULL
      ORDER BY date DESC, originCreatedAt DESC, version DESC, id DESC LIMIT :limit OFFSET :from`,
  ),
  key: db.prepare<[string], Key>(
    `SELECT date, originCreatedAt, version, id FROM transactions WHERE id = ? AND deletedAt IS NULL`,
  ),
  // The rows before it in the list: each one's key is greater, in the list's descending order.
  before: db
    .prepare<Key, number>(
      `SELECT count(*) FROM transactions WHERE deletedAt IS NULL
        AND (date, originCreatedAt, version, id)
          > (:date, :originCreatedAt, :version, :id)`,
    )
    .pluck(),
  // Sorted here, not in SQL: a few hundred at most, and no sort for SQLite to build.
  withIds: db.prepare<[string], Head & { originCreatedAt: number; version: string }>(
    `SELECT id, date, description, originCreatedAt, version FROM transactions
      WHERE deletedAt IS NULL AND id IN (SELECT value FROM json_each(?))`,
  ),
  // Read along `transactions_listed`, whose first column is the day: no sort (see the plan test).
  days: db.prepare<[], ListedDay>(
    `SELECT date, count(*) AS count FROM transactions WHERE deletedAt IS NULL
      GROUP BY date ORDER BY date DESC`,
  ),
  // What each day's categories and income sources took, negated: a spend's category gains what
  // I lost, and a source gives what I gained. A move between my accounts posts to neither.
  nets: db.prepare<[string], { date: string; currency: string; cents: number }>(
    `SELECT t.date, p.currency, -sum(p.amountCents) AS cents
      FROM transactions AS t CROSS JOIN postings AS p CROSS JOIN accounts AS a
      WHERE t.date IN (SELECT value FROM json_each(?)) AND t.deletedAt IS NULL
        AND p.transactionId = t.id AND a.id = p.accountId AND a.kind IN ('category', 'income')
      GROUP BY t.date, p.currency ORDER BY t.date DESC, p.currency`,
  ),
  // An account can arrive after its transaction under sync, so it may not be here yet.
  postings: db.prepare<[string], Row>(
    `SELECT p.transactionId, p.position, p.currency, p.amountCents AS cents, a.path, a.kind
      FROM postings AS p LEFT JOIN accounts AS a ON a.id = p.accountId
      WHERE p.transactionId IN (SELECT value FROM json_each(?))`,
  ),
}))

/** `limit` rows of the list from row `from`, and how many rows it has in all. */
export function pageOfTransactions(
  db: Database.Database,
  { from, limit }: InputOf<'transaction.page'>,
): Values['transaction.page'] {
  const s = statements(db)
  const heads = s.page.all({ from, limit })
  return { total: s.total.get() ?? 0, from, rows: listed(db, heads), nets: netsOf(db, heads) }
}

/** Every day of the list, newest first, and how many rows each has. */
export const daysOfTransactions = (db: Database.Database): ListedDay[] => statements(db).days.all()

/** The net of each day these rows are on, newest first; a day that nets to nothing has none. */
function netsOf(db: Database.Database, heads: readonly Head[]): DayNet[] {
  const dates = [...new Set(heads.map((h) => h.date))]
  if (dates.length === 0) return []
  const byDay = new Map<string, Money[]>(dates.map((d) => [d, []]))
  for (const { date, currency, cents } of statements(db).nets.all(JSON.stringify(dates))) {
    if (cents !== 0) byDay.get(date)?.push({ amount: format(cents), currency })
  }
  return [...byDay].map(([date, net]) => ({ date, net }))
}

/** Where the transaction sits in the list, counting from 0; null when it isn't live. */
export function positionOf(db: Database.Database, id: string): number | null {
  const s = statements(db)
  const key = s.key.get(id)
  return key === undefined ? null : (s.before.get(key) ?? 0)
}

/** The live ones of `ids`, in the list's order: a report's spends, or the rows a place keeps. */
export function transactionsWithIds(
  db: Database.Database,
  ids: readonly string[],
): ListedTransaction[] {
  const heads = statements(db)
    .withIds.all(JSON.stringify(ids))
    .sort((a, b) => keyOrder(b, a))
  return listed(db, heads)
}

/** The whole list. Main never sends it: tests read it, as the pages' sum. */
export function listTransactions(db: Database.Database): ListedTransaction[] {
  return pageOfTransactions(db, { from: 0, limit: -1 }).rows
}

const keyOrder = (a: Key, b: Key) =>
  compare(a.date, b.date) ||
  a.originCreatedAt - b.originCreatedAt ||
  compare(a.version, b.version) ||
  compare(a.id, b.id)

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Each head with its postings, as the list shows it. */
function listed(db: Database.Database, heads: readonly Head[]): ListedTransaction[] {
  if (heads.length === 0) return []
  const legsOf = new Map<string, Row[]>(heads.map((h) => [h.id, []]))
  for (const row of statements(db).postings.all(JSON.stringify(heads.map((h) => h.id)))) {
    legsOf.get(row.transactionId)?.push(row)
  }
  return heads.map(({ id, date, description }) => {
    const rows = (legsOf.get(id) ?? []).sort((a, b) => a.position - b.position)
    const legs: Leg[] = rows.map((r) => ({ cents: r.cents, currency: r.currency }))
    const paths = rows.map((r) =>
      r.path === null || r.kind === null ? null : { path: r.path, kind: r.kind },
    )
    const simple = simpleAmountOf(legs)
    const from = simple && paths[legs.findIndex((l) => l.cents < 0)]
    const to = simple && paths[legs.findIndex((l) => l.cents > 0)]
    // An account that can pay, or income: a starting balance comes from `equity:opening`.
    const fromName = from && (isAddable(from.kind) || from.kind === INCOME) ? from : null
    const toName = from && to && sendable(from.kind, to.kind) ? to : null
    return {
      id,
      date,
      description,
      amounts: movedIn(legs),
      simple: simple && { amount: format(simple.cents), currency: simple.currency },
      from: fromName && nameOf(fromName.path),
      to: toName && nameOf(toName.path),
      fromPath: fromName?.path ?? null,
      toPath: toName?.path ?? null,
    }
  })
}

/** The sum of the positive legs in each currency, by currency code. */
function movedIn(legs: Leg[]): Money[] {
  const moved = new Map<string, number>()
  for (const { cents, currency } of legs) {
    if (cents > 0) moved.set(currency, (moved.get(currency) ?? 0) + cents)
  }
  return [...moved]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, cents]) => ({ amount: format(cents), currency }))
}
