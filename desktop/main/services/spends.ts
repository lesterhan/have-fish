// Writing down a spend, and the list of what's been written.

import { randomUUID } from 'node:crypto'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { format, parse } from '@have-fish/core/money'
import { type Failure, failure, type Outcome } from '@have-fish/core/outcome'
import { type Leg, simpleAmountOf } from '@have-fish/core/postings'
import type Database from 'better-sqlite3'
import { desc, eq, isNull } from 'drizzle-orm'
import type { InputOf, ListedTransaction, Money } from '../../shared/commands'
import type { Context } from '../context'
import { perConnection } from '../db/prepared'
import { postings, transactions } from '../db/schema'
import { liveAccountAt } from '../ledger/store'

/** Every spend's currency, until a setting chooses it. */
export const HOME_CURRENCY = 'CAD'

/** Where a spend comes from and goes to, until the window lets you choose. */
const WALLET = { path: 'assets:cash', kind: 'cash' } as const
const UNSORTED = { path: 'expenses:unsorted', kind: 'category' } as const

/** A spend from the wallet to unsorted, dated today, in one batch with any account it needs. */
export function writeSpend(ctx: Context, input: InputOf<'spend.write'>): Outcome<{ id: string }> {
  const cents = parse(input.amount)
  if (cents === null) return failure('AMOUNT_INVALID', { amount: input.amount })
  if (cents <= 0) return failure('AMOUNT_NOT_POSITIVE', { amount: input.amount })

  const now = ctx.now()
  const made = { createdAt: now, deviceId: ctx.ledger.meta.deviceId }
  const from = accountFor(ctx.ledger.db, WALLET, made)
  const to = accountFor(ctx.ledger.db, UNSORTED, made)
  const spend: TransactionDoc = {
    type: 'transaction',
    id: randomUUID(),
    date: calendarDateAt(now, ctx.timeZone()),
    description: input.description.trim(),
    postings: [
      { accountId: to.id, amount: format(cents), currency: HOME_CURRENCY },
      { accountId: from.id, amount: format(-cents), currency: HOME_CURRENCY },
    ],
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }

  const applied = ctx.apply([...from.made, ...to.made, spend], now)
  if (!applied.ok) {
    const { code, details } = applied.failure
    return { ok: false, failure: { code, details } as Failure }
  }
  return { ok: true, value: { id: spend.id } }
}

/** The live account at the path, or a new one the app makes, for the same batch. */
function accountFor(
  db: Database.Database,
  at: Pick<AccountDoc, 'path' | 'kind'>,
  made: { createdAt: number; deviceId: string },
): { id: string; made: AccountDoc[] } {
  const id = liveAccountAt(db, at.path)
  if (id !== undefined) return { id, made: [] }
  const account: AccountDoc = {
    type: 'account',
    id: randomUUID(),
    ...at,
    currency: null,
    deletedAt: null,
    origin: { source: 'system', ...made },
  }
  return { id: account.id, made: [account] }
}

const statements = perConnection((orm) => ({
  // One row per posting, with its transaction; a transaction's rows are together.
  listed: orm
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      currency: postings.currency,
      cents: postings.amountCents,
    })
    .from(transactions)
    .leftJoin(postings, eq(postings.transactionId, transactions.id))
    .where(isNull(transactions.deletedAt))
    .orderBy(
      desc(transactions.date),
      desc(transactions.originCreatedAt),
      desc(transactions.version),
      transactions.id,
      postings.position,
    )
    .prepare(),
}))

/** Every live transaction, newest day first, and newest made first within a day. */
export function listTransactions(db: Database.Database): ListedTransaction[] {
  const grouped: { row: { id: string; date: string; description: string }; legs: Leg[] }[] = []
  for (const row of statements(db).listed.all()) {
    let last = grouped.at(-1)
    if (last?.row.id !== row.id) {
      last = { row, legs: [] }
      grouped.push(last)
    }
    if (row.currency !== null && row.cents !== null) {
      last.legs.push({ cents: row.cents, currency: row.currency })
    }
  }
  return grouped.map(({ row: { id, date, description }, legs }) => {
    const simple = simpleAmountOf(legs)
    return {
      id,
      date,
      description,
      amounts: movedIn(legs),
      simple: simple && { amount: format(simple.cents), currency: simple.currency },
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
