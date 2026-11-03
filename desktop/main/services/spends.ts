// Writing down a spend, and the list of what's been written.

import { randomUUID } from 'node:crypto'
import { type AccountKind, isAddable } from '@have-fish/core/account-kind'
import { nameOf, pathFor } from '@have-fish/core/account-path'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { format, parseTyped, cents as toCents } from '@have-fish/core/money'
import { failure, type Outcome } from '@have-fish/core/outcome'
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
import { HOME_CURRENCY } from '../../shared/currency'
import type { Context } from '../context'
import { perConnection } from '../db/prepared'
import { accounts, postings, transactions } from '../db/schema'
import { getDocument, liveAccountAt } from '../ledger/store'
import { applyKeeping, type Change, record } from '../undo/steps'
import { accountFor, idOf } from './applied'

/** Where a spend comes from before any account is chosen, and goes when it has no category. */
const WALLET = { path: 'assets:cash', kind: 'cash' } as const
const UNSORTED = { path: 'expenses:unsorted', kind: 'category' } as const

/**
 * A spend from the account that paid to its category, dated today, in one batch with any account it
 * needs. An account kept to one currency pays in that currency; any other, in the home currency.
 */
export function writeSpend(ctx: Context, input: InputOf<'spend.write'>): Outcome<{ id: string }> {
  const amount = spendAmount(input.amount)
  if (!amount.ok) return amount
  const cents = amount.value

  const now = ctx.now()
  const made = { createdAt: now, deviceId: ctx.ledger.meta.deviceId }
  const from = paidFrom(ctx, input.from ?? null, made)
  if (!from.ok) return from
  const to = categoryFor(ctx.ledger.db, input.category ?? '', made)
  const currency = from.value.currency ?? HOME_CURRENCY
  const spend: TransactionDoc = {
    type: 'transaction',
    id: randomUUID(),
    date: calendarDateAt(now, ctx.timeZone()),
    description: input.description.trim(),
    postings: [
      { accountId: to.id, amount: format(cents), currency },
      { accountId: from.value.id, amount: format(-cents), currency },
    ],
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }

  const docs = [...from.value.made, ...to.made, spend]
  const { applied, changes } = applyKeeping(ctx, docs, now, [spend])
  record(ctx, { kind: 'write', description: spend.description }, changes)
  const written = idOf(applied, spend.id)
  if (written.ok) ctx.machine.usedFrom(from.value.id)
  return written
}

/** The account a spend with no `from` comes out of: the one used last here, else the wallet. */
export function assumedFrom(ctx: Context): { id: string | null } {
  const last = ctx.machine.lastFrom()
  if (last !== null && payer(ctx.ledger.db, last).ok) return { id: last }
  const wallet = liveAccountAt(ctx.ledger.db, WALLET.path)
  return { id: wallet !== undefined && payer(ctx.ledger.db, wallet).ok ? wallet : null }
}

type Paying = { id: string; currency: string | null; made: AccountDoc[] }

/** The account named, or the one assumed: the wallet, made in the same batch if it's new. */
function paidFrom(
  ctx: Context,
  named: string | null,
  made: { createdAt: number; deviceId: string },
): Outcome<Paying> {
  const id = named ?? assumedFrom(ctx).id
  if (id === null) {
    const wallet = accountFor(ctx.ledger.db, WALLET, made)
    return { ok: true, value: { ...wallet, currency: null } }
  }
  const account = payer(ctx.ledger.db, id)
  return account.ok
    ? { ok: true, value: { id, currency: account.value.currency, made: [] } }
    : account
}

/** A live account I added: what can pay. Never a category, nor an account the app keeps. */
function payer(db: Database.Database, id: string): Outcome<AccountDoc> {
  const stored = getDocument(db, 'account', id)
  if (stored === null || !isAddable(stored.doc.kind)) {
    return failure('ACCOUNT_NOT_FOUND', { accountId: id })
  }
  if (stored.doc.deletedAt !== null) return failure('ACCOUNT_DELETED', { accountId: id })
  return { ok: true, value: stored.doc }
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

  const now = ctx.now()
  const db = ctx.ledger.db
  const into = doc.postings.find((p) => toCents(p.amount) > 0)?.accountId
  // Only a spend into a category changes category: a starting balance goes into an account.
  const recategorised =
    input.category !== undefined && into !== undefined && isCategory(db, into)
      ? categoryFor(db, input.category, { createdAt: now, deviceId: ctx.ledger.meta.deviceId })
      : { id: into, made: [] }

  const description = input.description.trim()
  // An unchanged save writes no version, so sync has nothing to send, and undo nothing to take back.
  if (cents === simple.cents && description === doc.description && recategorised.id === into) {
    return { edited: { ok: true, value: { id } }, changes: [] }
  }

  const edited: TransactionDoc = {
    ...doc,
    description,
    postings: doc.postings.map((p) => {
      const positive = toCents(p.amount) > 0
      return {
        ...p,
        accountId: positive && recategorised.id !== undefined ? recategorised.id : p.accountId,
        amount: format(positive ? cents : -cents),
      }
    }),
  }
  const { applied, changes } = applyKeeping(ctx, [...recategorised.made, edited], now, [edited])
  return { edited: idOf(applied, id), changes }
}

/**
 * The category named, as typed: the one at `expenses:<name>`, whatever its case, or a new one in
 * the same batch, mine since I named it. Nothing typed is unsorted, which the app makes.
 */
function categoryFor(
  db: Database.Database,
  typed: string,
  made: { createdAt: number; deviceId: string },
): { id: string; made: AccountDoc[] } {
  const name = typed.trim()
  if (name === '') return accountFor(db, UNSORTED, made)
  const path = pathFor('category', name)
  const id = liveAccountAt(db, path)
  if (id !== undefined) return { id, made: [] }
  const account: AccountDoc = {
    type: 'account',
    id: randomUUID(),
    path,
    kind: 'category',
    currency: null,
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }
  return { id: account.id, made: [account] }
}

const isCategory = (db: Database.Database, id: string) =>
  getDocument(db, 'account', id)?.doc.kind === 'category'

/** A tombstone in place of the spend, so it counts nowhere; undo writes it back as it was. */
export function removeSpend(ctx: Context, input: InputOf<'spend.remove'>): Outcome<{ id: string }> {
  const { id } = input
  const stored = getDocument(ctx.ledger.db, 'transaction', id)
  if (stored === null) return failure('TRANSACTION_NOT_FOUND', { id })
  const { doc } = stored
  if (doc.deletedAt !== null) return failure('TRANSACTION_DELETED', { id })

  const now = ctx.now()
  const tombstone: TransactionDoc = { ...doc, postings: [], deletedAt: now }
  const { applied, changes } = applyKeeping(ctx, [tombstone], now, [tombstone])
  record(ctx, { kind: 'remove', description: doc.description }, changes)
  return idOf(applied, id)
}

/** A spend's amount as typed, in cents: a number, and more than zero. */
function spendAmount(typed: string): Outcome<number> {
  const cents = parseTyped(typed)
  if (cents === null) return failure('AMOUNT_INVALID', { amount: typed })
  if (cents <= 0) return failure('AMOUNT_NOT_POSITIVE', { amount: typed })
  return { ok: true, value: cents }
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
      path: accounts.path,
      kind: accounts.kind,
    })
    .from(transactions)
    .leftJoin(postings, eq(postings.transactionId, transactions.id))
    // An account can arrive after its transaction under sync, so it may not be here yet.
    .leftJoin(accounts, eq(accounts.id, postings.accountId))
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
  type Grouped = { row: { id: string; date: string; description: string }; legs: Leg[] }
  // Each leg's account, or null while it hasn't arrived.
  type Account = { path: string; kind: AccountKind } | null
  const grouped: (Grouped & { paths: Account[] })[] = []
  for (const row of statements(db).listed.all()) {
    let last = grouped.at(-1)
    if (last?.row.id !== row.id) {
      last = { row, legs: [], paths: [] }
      grouped.push(last)
    }
    if (row.currency !== null && row.cents !== null) {
      last.legs.push({ cents: row.cents, currency: row.currency })
      last.paths.push(
        row.path === null || row.kind === null ? null : { path: row.path, kind: row.kind },
      )
    }
  }
  return grouped.map(({ row: { id, date, description }, legs, paths }) => {
    const simple = simpleAmountOf(legs)
    const from = simple && paths[legs.findIndex((l) => l.cents < 0)]
    const to = simple && paths[legs.findIndex((l) => l.cents > 0)]
    return {
      id,
      date,
      description,
      amounts: movedIn(legs),
      simple: simple && { amount: format(simple.cents), currency: simple.currency },
      // Only an account that can pay: a starting balance comes from `equity:opening`, not from it.
      from: from && isAddable(from.kind) ? nameOf(from.path) : null,
      category: to && to.kind === 'category' ? nameOf(to.path) : null,
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
