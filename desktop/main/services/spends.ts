// Writing down a spend, and the list of what's been written.

import { randomUUID } from 'node:crypto'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { format, parse, cents as toCents } from '@have-fish/core/money'
import { type Failure, failure, type Outcome } from '@have-fish/core/outcome'
import { type Leg, simpleAmountOf } from '@have-fish/core/postings'
import type Database from 'better-sqlite3'
import { desc, eq, isNull } from 'drizzle-orm'
import {
  type InputOf,
  type ListedTransaction,
  type Money,
  type Values,
  wireFailure,
} from '../../shared/commands'
import type { Context } from '../context'
import { perConnection } from '../db/prepared'
import { postings, transactions } from '../db/schema'
import type { BatchOutcome } from '../ledger/apply'
import { getDocument, liveAccountAt } from '../ledger/store'
import { applyKeeping, type Change, record } from '../undo/steps'

/** Every spend's currency, until a setting chooses it. */
export const HOME_CURRENCY = 'CAD'

/** Where a spend comes from and goes to, until the window lets you choose. */
const WALLET = { path: 'assets:cash', kind: 'cash' } as const
const UNSORTED = { path: 'expenses:unsorted', kind: 'category' } as const

/** A spend from the wallet to unsorted, dated today, in one batch with any account it needs. */
export function writeSpend(ctx: Context, input: InputOf<'spend.write'>): Outcome<{ id: string }> {
  const amount = spendAmount(input.amount)
  if (!amount.ok) return amount
  const cents = amount.value

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

  const { applied, changes } = applyKeeping(ctx, [...from.made, ...to.made, spend], now, [spend])
  record(ctx, { kind: 'write', description: spend.description }, changes)
  return idOf(applied, spend.id)
}

/**
 * A new version of a spend with a new amount and description. The positive leg gets the amount
 * and the other its negative; the id, date, accounts and origin stay as they were.
 */
export function editSpend(ctx: Context, input: InputOf<'spend.edit'>): Outcome<{ id: string }> {
  const { edited, changes } = edit(ctx, input)
  record(ctx, { kind: 'edit', description: input.description.trim() }, changes)
  return edited
}

/** Each edit as its own batch, so one refused doesn't hold back the rest, and one step to undo. */
export function saveAllSpends(
  ctx: Context,
  input: InputOf<'spend.saveAll'>,
): Outcome<Values['spend.saveAll']> {
  const saves = input.edits.map((e) => ({ id: e.id, ...edit(ctx, e) }))
  const changes = saves.flatMap((s) => s.changes)
  // One spend saved reads as that spend's edit.
  const only = changes.length === 1 ? changes[0]?.after.doc : undefined
  record(
    ctx,
    only?.type === 'transaction'
      ? { kind: 'edit', description: only.description }
      : { kind: 'saveAll', count: changes.length },
    changes,
  )
  const value = saves.map(({ id, edited }) => ({
    id,
    refused: edited.ok ? null : wireFailure(edited.failure),
  }))
  return { ok: true, value }
}

/** An edit, applied, and what it changed for the history. */
function edit(
  ctx: Context,
  input: InputOf<'spend.edit'>,
): { edited: Outcome<{ id: string }>; changes: Change[] } {
  const amount = spendAmount(input.amount)
  if (!amount.ok) return { edited: amount, changes: [] }
  const cents = amount.value

  const { id } = input
  const stored = getDocument(ctx.ledger.db, 'transaction', id)
  const refused = (f: Outcome<never>) => ({ edited: f, changes: [] })
  if (stored === null) return refused(failure('TRANSACTION_NOT_FOUND', { id }))
  const { doc } = stored
  if (doc.deletedAt !== null) return refused(failure('TRANSACTION_DELETED', { id }))
  const simple = simpleAmountOf(doc.postings.map((p) => ({ ...p, cents: toCents(p.amount) })))
  if (simple === null) return refused(failure('TRANSACTION_NOT_SIMPLE', { id }))

  const description = input.description.trim()
  // An unchanged save writes no version, so sync has nothing to send, and undo nothing to take back.
  if (cents === simple.cents && description === doc.description) {
    return { edited: { ok: true, value: { id } }, changes: [] }
  }

  const edited: TransactionDoc = {
    ...doc,
    description,
    postings: doc.postings.map((p) => ({
      ...p,
      amount: format(toCents(p.amount) > 0 ? cents : -cents),
    })),
  }
  const { applied, changes } = applyKeeping(ctx, [edited], ctx.now(), [edited])
  return { edited: idOf(applied, id), changes }
}

/** A spend's amount as typed, in cents: a number, and more than zero. */
function spendAmount(typed: string): Outcome<number> {
  const cents = parse(typed)
  if (cents === null) return failure('AMOUNT_INVALID', { amount: typed })
  if (cents <= 0) return failure('AMOUNT_NOT_POSITIVE', { amount: typed })
  return { ok: true, value: cents }
}

/** The id, once the batch is applied; a refusal without its place in the batch. */
function idOf(applied: BatchOutcome, id: string): Outcome<{ id: string }> {
  if (!applied.ok) {
    const { code, details } = applied.failure
    return { ok: false, failure: { code, details } as Failure }
  }
  return { ok: true, value: { id } }
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
