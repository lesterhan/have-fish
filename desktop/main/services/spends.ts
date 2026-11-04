// Writing down a spend, and the list of what's been written.

import { randomUUID } from 'node:crypto'
import { type AccountKind, isAddable } from '@have-fish/core/account-kind'
import { nameOf, pathFor } from '@have-fish/core/account-path'
import { calendarDateAt, isCalendarDate } from '@have-fish/core/calendar-date'
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
  type To,
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
const INCOME = 'income'

/**
 * A spend from the account that paid to its category, a transfer to another account of mine, or
 * income from a source into an account of mine, on the day given or else today, in one batch
 * with any account it needs. It's in the currency the account paying is kept to, else the one the
 * account it goes to is kept to, else the home currency.
 */
export function writeSpend(ctx: Context, input: InputOf<'spend.write'>): Outcome<{ id: string }> {
  const amount = spendAmount(input.amount)
  if (!amount.ok) return amount
  const cents = amount.value

  const now = ctx.now()
  const typedDate = input.date ?? ''
  const date = typedDate === '' ? calendarDateAt(now, ctx.timeZone()) : typedDate
  if (!isCalendarDate(date)) return failure('DATE_INVALID', { date })
  const made = { createdAt: now, deviceId: ctx.ledger.meta.deviceId }
  const named = input.from ?? null
  const income = typeof named === 'object' && named !== null
  const from: Outcome<End> = income
    ? {
        ok: true,
        value: { ...namedFor(ctx.ledger.db, INCOME, named.income, made), currency: null },
      }
    : paidFrom(ctx, named, made)
  if (!from.ok) return from
  const goesTo = input.to ?? { category: '' }
  if (income && 'category' in goesTo) {
    return failure('INCOME_NOT_TO_ACCOUNT', { accountId: from.value.id })
  }
  const to = destination(ctx.ledger.db, goesTo, from.value.id, made)
  if (!to.ok) return to
  const currency = from.value.currency ?? to.value.currency ?? HOME_CURRENCY
  const spend: TransactionDoc = {
    type: 'transaction',
    id: randomUUID(),
    date,
    description: input.description.trim(),
    postings: [
      { accountId: to.value.id, amount: format(cents), currency },
      { accountId: from.value.id, amount: format(-cents), currency },
    ],
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }

  const docs = [...from.value.made, ...to.value.made, spend]
  const { applied, changes } = applyKeeping(ctx, docs, now, [spend])
  record(ctx, { kind: 'write', description: spend.description }, changes)
  const written = idOf(applied, spend.id)
  // Only an account that pays: the next coffee never comes out of salary.
  if (written.ok && !income) ctx.machine.usedFrom(from.value.id)
  return written
}

/** The account a spend with no `from` comes out of: the one used last here, else the wallet. */
export function assumedFrom(ctx: Context): { id: string | null } {
  const last = ctx.machine.lastFrom()
  if (last !== null && payer(ctx.ledger.db, last).ok) return { id: last }
  const wallet = liveAccountAt(ctx.ledger.db, WALLET.path)
  return { id: wallet !== undefined && payer(ctx.ledger.db, wallet).ok ? wallet : null }
}

/** An account in a spend or transfer: its currency if it's kept to one, and any doc it needs made. */
type End = { id: string; currency: string | null; made: AccountDoc[] }

type Made = { createdAt: number; deviceId: string }

/** The account named, or the one assumed: the wallet, made in the same batch if it's new. */
function paidFrom(ctx: Context, named: string | null, made: Made): Outcome<End> {
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

/**
 * A live account I added: what can pay, and what a transfer goes to. Never a category, nor an
 * account the app keeps.
 */
function payer(db: Database.Database, id: string): Outcome<AccountDoc> {
  const stored = getDocument(db, 'account', id)
  if (stored === null || !isAddable(stored.doc.kind)) {
    return failure('ACCOUNT_NOT_FOUND', { accountId: id })
  }
  if (stored.doc.deletedAt !== null) return failure('ACCOUNT_DELETED', { accountId: id })
  return { ok: true, value: stored.doc }
}

/**
 * A new version of a spend with a new amount, description, and maybe category or date. The
 * positive leg gets the amount and the other its negative; the id, account paying and origin stay.
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
  if (input.date !== undefined && !isCalendarDate(input.date)) {
    return { edited: failure('DATE_INVALID', { date: input.date }), changes: [] }
  }

  const { id } = input
  const db = ctx.ledger.db
  const stored = getDocument(db, 'transaction', id)
  const refused = (f: Outcome<never>) => ({ edited: f, changes: [] })
  if (stored === null) return refused(failure('TRANSACTION_NOT_FOUND', { id }))
  const { doc } = stored
  if (doc.deletedAt !== null) return refused(failure('TRANSACTION_DELETED', { id }))
  const simple = simpleAmountOf(doc.postings.map((p) => ({ ...p, cents: toCents(p.amount) })))
  if (simple === null) return refused(failure('TRANSACTION_NOT_SIMPLE', { id }))

  const now = ctx.now()
  const into = doc.postings.find((p) => toCents(p.amount) > 0)?.accountId
  const out = doc.postings.find((p) => toCents(p.amount) < 0)?.accountId
  const fromIncome = out !== undefined && getDocument(db, 'account', out)?.doc.kind === 'income'
  if (fromIncome && input.to !== undefined && 'category' in input.to) {
    return refused(failure('INCOME_NOT_TO_ACCOUNT', { accountId: out }))
  }
  // Only money out of an account of mine, or in from income, can go elsewhere: a starting
  // balance comes from equity.
  const moved =
    input.to !== undefined && into !== undefined && out !== undefined && movable(db, out, into)
      ? destination(db, input.to, out, { createdAt: now, deviceId: ctx.ledger.meta.deviceId })
      : { ok: true as const, value: { id: into, made: [] } }
  if (!moved.ok) return refused(moved)

  const description = input.description.trim()
  const date = input.date ?? doc.date
  // An unchanged save writes no version, so sync has nothing to send, and undo nothing to take back.
  if (
    cents === simple.cents &&
    description === doc.description &&
    moved.value.id === into &&
    date === doc.date
  ) {
    return { edited: { ok: true, value: { id } }, changes: [] }
  }

  const edited: TransactionDoc = {
    ...doc,
    date,
    description,
    postings: doc.postings.map((p) => {
      const positive = toCents(p.amount) > 0
      return {
        ...p,
        accountId: positive && moved.value.id !== undefined ? moved.value.id : p.accountId,
        amount: format(positive ? cents : -cents),
      }
    }),
  }
  const { applied, changes } = applyKeeping(ctx, [...moved.value.made, edited], now, [edited])
  return { edited: idOf(applied, id), changes }
}

/** Where money from `from` goes: a category, or another account of mine. */
function destination(db: Database.Database, to: To, from: string, made: Made): Outcome<End> {
  if ('category' in to)
    return { ok: true, value: { ...categoryFor(db, to.category, made), currency: null } }
  if (to.account === from) return failure('TRANSFER_TO_ITSELF', { accountId: from })
  const account = payer(db, to.account)
  return account.ok
    ? { ok: true, value: { id: to.account, currency: account.value.currency, made: [] } }
    : account
}

/** The category named, as typed; nothing typed is unsorted, which the app makes. */
function categoryFor(db: Database.Database, typed: string, made: Made) {
  return typed.trim() === ''
    ? accountFor(db, UNSORTED, made)
    : namedFor(db, 'category', typed, made)
}

/**
 * The category or income source named, as typed: the one at its path, whatever its case, or a new
 * one in the same batch, mine since I named it.
 */
function namedFor(
  db: Database.Database,
  kind: typeof INCOME | 'category',
  typed: string,
  made: Made,
): { id: string; made: AccountDoc[] } {
  const name = typed.trim()
  const path = pathFor(kind, name)
  const id = liveAccountAt(db, path)
  if (id !== undefined) return { id, made: [] }
  const account: AccountDoc = {
    type: 'account',
    id: randomUUID(),
    path,
    kind,
    currency: null,
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }
  return { id: account.id, made: [account] }
}

/**
 * Whether an edit can send this money elsewhere: out of an account of mine, into a category or
 * another; or in from income, into an account of mine.
 */
function movable(db: Database.Database, out: string, into: string): boolean {
  const kind = (id: string) => getDocument(db, 'account', id)?.doc.kind
  const to = kind(into)
  const from = kind(out)
  return from !== undefined && to !== undefined && sendable(from, to)
}

/** Whether money from `from` to `to` is one an edit can change: a spend, transfer or income. */
const sendable = (from: AccountKind, to: AccountKind) =>
  (isAddable(from) && goesTo(to)) || (from === INCOME && isAddable(to))

/** Where money from an account of mine can go: a category, or another account of mine. */
const goesTo = (kind: AccountKind) => kind === 'category' || isAddable(kind)

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
      // An account that can pay, or income: a starting balance comes from `equity:opening`.
      from: from && (isAddable(from.kind) || from.kind === INCOME) ? nameOf(from.path) : null,
      to: from && to && sendable(from.kind, to.kind) ? nameOf(to.path) : null,
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
