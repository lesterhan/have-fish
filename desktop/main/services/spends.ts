// Writing down a spend, and the list of what's been written.

import { randomUUID } from 'node:crypto'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { format, parse } from '@have-fish/core/money'
import { type Failure, failure, type Outcome } from '@have-fish/core/outcome'
import type Database from 'better-sqlite3'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { InputOf, ListedTransaction } from '../../shared/commands'
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
  // One row per transaction and currency; the join's `amountCents > 0` keeps a transaction with
  // nothing positive, such as all zeroes, as one row with no currency.
  listed: orm
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      currency: postings.currency,
      cents: sql<number | null>`sum(${postings.amountCents})`,
    })
    .from(transactions)
    .leftJoin(
      postings,
      and(eq(postings.transactionId, transactions.id), gt(postings.amountCents, 0)),
    )
    .where(isNull(transactions.deletedAt))
    .groupBy(transactions.id, postings.currency)
    .orderBy(
      desc(transactions.date),
      desc(transactions.originCreatedAt),
      desc(transactions.version),
      transactions.id,
      postings.currency,
    )
    .prepare(),
}))

/** Every live transaction, newest day first, and newest made first within a day. */
export function listTransactions(db: Database.Database): ListedTransaction[] {
  const listed: ListedTransaction[] = []
  for (const row of statements(db).listed.all()) {
    let last = listed.at(-1)
    if (last?.id !== row.id) {
      last = { id: row.id, date: row.date, description: row.description, amounts: [] }
      listed.push(last)
    }
    if (row.currency !== null && row.cents !== null) {
      last.amounts.push({ amount: format(row.cents), currency: row.currency })
    }
  }
  return listed
}
