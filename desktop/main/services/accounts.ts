// Adding an account on purpose, and the list of the ones I have and owe.

import { randomUUID } from 'node:crypto'
import {
  ADDABLE_KINDS,
  type AddableKind,
  classOf,
  isAddable,
  rootOf,
} from '@have-fish/core/account-kind'
import { nameOf, pathFor } from '@have-fish/core/account-path'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import { fitsCurrency } from '@have-fish/core/currencies'
import type { AccountDoc, LedgerDocument, TransactionDoc } from '@have-fish/core/documents'
import { format, parseTyped } from '@have-fish/core/money'
import { failure, type Outcome } from '@have-fish/core/outcome'
import { OPENING } from '@have-fish/core/own-accounts'
import { legsOf } from '@have-fish/core/shapes'
import type Database from 'better-sqlite3'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { alias } from 'drizzle-orm/sqlite-core'
import { copy } from '../../copy'
import type { InputOf, ListedAccount, Money } from '../../shared/commands'
import { HOME_CURRENCY } from '../../shared/currency'
import type { Context } from '../context'
import { perConnection } from '../db/prepared'
import { accounts, postings, transactions } from '../db/schema'
import { getDocument, liveAccountAt } from '../ledger/store'
import { applyKeeping, record } from '../undo/steps'
import { accountFor, idOf } from './applied'

type Made = { createdAt: number; deviceId: string }

/** The roots an account I add can sit under: `assets` and `liabilities`. */
const ADDABLE_ROOTS = [...new Set(ADDABLE_KINDS.map(rootOf))]

/**
 * The name of a live account I have or owe that `name` matches without regard to case, as it
 * was typed. Only those roots hold accounts I add, so one indexed lookup under each answers it.
 */
function nameTaken(db: Database.Database, name: string): string | undefined {
  for (const root of ADDABLE_ROOTS) {
    const id = liveAccountAt(db, `${root}:${name}`)
    const found = id === undefined ? null : getDocument(db, 'account', id)
    if (found?.doc.type === 'account') return nameOf(found.doc.path)
  }
  return undefined
}

/**
 * An account under its kind's root, named as typed, in a batch of its own. A name I already
 * have is refused whatever its kind, since the list shows names without their roots.
 */
export function addAccount(ctx: Context, input: InputOf<'account.add'>): Outcome<{ id: string }> {
  const name = input.name.trim()
  if (name === '') return failure('ACCOUNT_NAME_EMPTY')
  const taken = nameTaken(ctx.ledger.db, name)
  if (taken !== undefined) return failure('ACCOUNT_NAME_TAKEN', { name: taken })

  const now = ctx.now()
  const made: Made = { createdAt: now, deviceId: ctx.ledger.meta.deviceId }
  const account: AccountDoc = {
    type: 'account',
    id: randomUUID(),
    path: pathFor(input.kind, name),
    kind: input.kind,
    currency: input.currency,
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }
  const start = startOf(ctx, account, input.start ?? '', made)
  if (!start.ok) return start
  const { docs, kept } = start.value ?? { docs: [], kept: [] }

  // The account and its starting balance are one batch, and one step.
  const { applied, changes } = applyKeeping(ctx, [account, ...docs], now, [account, ...kept])
  record(ctx, { kind: 'addAccount', name }, changes, { spends: [], accounts: [account.id] })
  return idOf(applied, account.id)
}

/** A starting balance for an account I added without one, as its own batch and step. */
export function startAccount(
  ctx: Context,
  input: InputOf<'account.start'>,
): Outcome<{ id: string | null }> {
  const { db } = ctx.ledger
  const { id } = input
  const stored = getDocument(db, 'account', id)
  if (stored === null || !isAddable(stored.doc.kind)) {
    return failure('ACCOUNT_NOT_FOUND', { accountId: id })
  }
  const account = stored.doc
  if (account.deletedAt !== null) return failure('ACCOUNT_DELETED', { accountId: id })
  if (startsOf(db).has(id)) return failure('ACCOUNT_ALREADY_STARTED', { accountId: id })

  const now = ctx.now()
  const start = startOf(ctx, account, input.amount, {
    createdAt: now,
    deviceId: ctx.ledger.meta.deviceId,
  })
  if (!start.ok) return start
  if (start.value === null) return { ok: true, value: { id: null } }

  const { docs, kept } = start.value
  const { applied, changes } = applyKeeping(ctx, docs, now, kept)
  record(ctx, { kind: 'start', name: nameOf(account.path) }, changes, {
    spends: [],
    accounts: [id],
  })
  const [transaction] = kept
  return transaction === undefined
    ? { ok: true, value: { id: null } }
    : idOf(applied, transaction.id)
}

/**
 * The transaction that says what was in an account today, against the opening account, with that
 * account if the app hasn't made it yet. Null when nothing was typed, or zero: there's nothing
 * to say. What I owe on a card or a loan goes on as a negative, which is what owing is.
 */
function startOf(
  ctx: Context,
  account: AccountDoc,
  typed: string,
  made: Made,
): Outcome<{ docs: LedgerDocument[]; kept: TransactionDoc[] } | null> {
  if (typed.trim() === '') return { ok: true, value: null }
  const cents = parseTyped(typed)
  if (cents === null) return failure('AMOUNT_INVALID', { amount: typed })
  if (cents === 0) return { ok: true, value: null }

  const signed = classOf(account.kind) === 'liability' ? -cents : cents
  const currency = account.currency ?? HOME_CURRENCY
  if (!fitsCurrency(cents, currency))
    return failure('AMOUNT_TOO_PRECISE', { amount: typed, currency })
  const opening = accountFor(ctx.ledger.db, OPENING, made)
  const legs = legsOf({
    account: { accountId: account.id, cents: signed, currency },
    opening: { accountId: opening.id, cents: -signed, currency },
  })
  const transaction: TransactionDoc = {
    type: 'transaction',
    id: randomUUID(),
    date: calendarDateAt(made.createdAt, ctx.timeZone()),
    description: copy.accounts.startDescription,
    postings: legs.map((l) => ({
      accountId: l.accountId,
      amount: format(l.cents),
      currency: l.currency,
    })),
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }
  return { ok: true, value: { docs: [...opening.made, transaction], kept: [transaction] } }
}

/**
 * What each account's postings sum to, per currency. No join to `transactions`: a removed one
 * keeps no postings. One covering index answers it, in order (see the plan test).
 */
export const balancesQuery = (orm: BetterSQLite3Database) =>
  orm
    .select({
      accountId: postings.accountId,
      currency: postings.currency,
      cents: sql<number>`sum(${postings.amountCents})`,
    })
    .from(postings)
    .groupBy(postings.accountId, postings.currency)
    .orderBy(postings.accountId, postings.currency)

const openingLeg = alias(postings, 'opening_leg')
const openingAccount = alias(accounts, 'opening_account')

const statements = perConnection((orm) => ({
  addable: orm
    .select({
      id: accounts.id,
      path: accounts.path,
      kind: accounts.kind,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), inArray(accounts.kind, [...ADDABLE_KINDS])))
    .prepare(),
  // Each live transaction with a leg on the opening account: its other legs, oldest first. CROSS
  // JOIN pins the order SQLite reads them in: from the opening account out, a few rows, where
  // any other order reads every transaction (see #608).
  starts: orm
    .select({
      accountId: postings.accountId,
      cents: postings.amountCents,
      currency: postings.currency,
      date: transactions.date,
    })
    .from(openingAccount)
    .crossJoin(openingLeg)
    .crossJoin(transactions)
    .crossJoin(postings)
    .where(
      and(
        eq(openingAccount.kind, 'opening'),
        eq(openingLeg.accountId, openingAccount.id),
        eq(transactions.id, openingLeg.transactionId),
        isNull(transactions.deletedAt),
        eq(postings.transactionId, openingLeg.transactionId),
        ne(postings.accountId, openingLeg.accountId),
      ),
    )
    .orderBy(transactions.date, transactions.originCreatedAt, transactions.id)
    .prepare(),
  balances: balancesQuery(orm).prepare(),
}))

/** Each account's balance by id, in currency order, leaving out what sums to zero. */
function balancesOf(db: Database.Database): Map<string, Money[]> {
  const found = new Map<string, Money[]>()
  for (const { accountId, currency, cents } of statements(db).balances.all()) {
    if (cents === 0) continue
    const held = found.get(accountId) ?? []
    held.push({ amount: format(cents), currency })
    found.set(accountId, held)
  }
  return found
}

type Start = { cents: number; currency: string; date: string }

/** Each account's starting balance, by id: the oldest, if sync ever brings two. */
function startsOf(db: Database.Database): Map<string, Start> {
  const found = new Map<string, Start>()
  for (const { accountId, ...start } of statements(db).starts.all()) {
    if (!found.has(accountId)) found.set(accountId, start)
  }
  return found
}

/** Every live account I have or owe, by name without regard to case. */
export function listAccounts(db: Database.Database): ListedAccount[] {
  const starts = startsOf(db)
  const balances = balancesOf(db)
  return statements(db)
    .addable.all()
    .map(({ id, path, kind, currency }) => {
      const start = starts.get(id)
      // What I owe shows as I typed it: the ledger holds it negative.
      const sign = classOf(kind) === 'liability' ? -1 : 1
      return {
        id,
        name: nameOf(path),
        // The query keeps only these kinds.
        kind: kind as AddableKind,
        currency,
        start: start
          ? { amount: format(sign * start.cents), currency: start.currency, date: start.date }
          : null,
        balance: balances.get(id) ?? [],
      }
    })
    .sort((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
}

const byName = new Intl.Collator('en', { sensitivity: 'accent' })
/** Without regard to case, as the ledger matches paths. */
