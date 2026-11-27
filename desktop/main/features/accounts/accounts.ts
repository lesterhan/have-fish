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
import { CONVERSION, OPENING } from '@have-fish/core/own-accounts'
import { legsOf, type ShapeLeg, shapeOf } from '@have-fish/core/shapes'
import type Database from 'better-sqlite3'
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { alias } from 'drizzle-orm/sqlite-core'
import { copy } from '../../../copy'
import type { InputOf, ListedAccount, Money } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'
import { accountFor, idOf, postingsOf } from '../../commands/applied'
import type { Context } from '../../context'
import { perConnection } from '../../db/prepared'
import { accounts, postings, transactions } from '../../db/schema'
import { getDocument, liveAccountAt } from '../../ledger/store'
import { applyKeeping, record } from '../../undo/steps'

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
    if (found !== null) return nameOf(found.doc.path)
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
  const start = startOf(ctx, account, input.start ?? '', input.cost ?? '', made)
  if (!start.ok) return start
  const { docs, kept } = start.value ?? { docs: [], kept: [] }

  // The account and its starting balance are one batch, and one step.
  const { applied, changes } = applyKeeping(ctx, [account, ...docs], now, [account, ...kept])
  record(ctx, { action: 'addAccount', name }, changes, { spends: [], accounts: [account.id] })
  return idOf(applied, account.id)
}

/** A starting balance for an account I added without one, as its own batch and step. */
export function startAccount(
  ctx: Context,
  input: InputOf<'account.start'>,
): Outcome<{ id: string | null }> {
  const { db } = ctx.ledger
  const { id } = input
  const live = liveAddable(db, id)
  if (!live.ok) return live
  const account = live.value
  if (startsOf(db).has(id)) return failure('ACCOUNT_ALREADY_STARTED', { accountId: id })

  const now = ctx.now()
  const start = startOf(ctx, account, input.amount, input.cost ?? '', {
    createdAt: now,
    deviceId: ctx.ledger.meta.deviceId,
  })
  if (!start.ok) return start
  if (start.value === null) return { ok: true, value: { id: null } }

  const { docs, kept } = start.value
  const { applied, changes } = applyKeeping(ctx, docs, now, kept)
  record(ctx, { action: 'start', name: nameOf(account.path) }, changes, {
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
 * Given its cost, in another currency than the home one, it goes through the conversion account.
 */
function startOf(
  ctx: Context,
  account: AccountDoc,
  typed: string,
  typedCost: string,
  made: Made,
): Outcome<{ docs: LedgerDocument[]; kept: TransactionDoc[] } | null> {
  const empty = typed.trim() === ''
  const cents = empty ? null : parseTyped(typed)
  const asked = typedCost.trim() !== ''
  const currency = account.currency ?? HOME_CURRENCY
  if (asked && (empty || cents === 0))
    return failure('START_NOT_COSTABLE', { accountId: account.id })
  if (asked && currency === HOME_CURRENCY)
    return failure('START_NOT_COSTABLE', { accountId: account.id })
  if (empty) return { ok: true, value: null }
  if (cents === null) return failure('AMOUNT_INVALID', { amount: typed })
  if (cents === 0) return { ok: true, value: null }

  const signed = classOf(account.kind) === 'liability' ? -cents : cents
  if (!fitsCurrency(cents, currency))
    return failure('AMOUNT_TOO_PRECISE', { amount: typed, currency })
  let cost: number | null = null
  if (asked) {
    const read = costOf(typedCost)
    if (!read.ok) return read
    cost = read.value
  }
  const { legs, made: accounts } = startLegs(
    ctx.ledger.db,
    { accountId: account.id, cents: signed, currency },
    cost,
    made,
  )
  const transaction: TransactionDoc = {
    type: 'transaction',
    id: randomUUID(),
    date: calendarDateAt(made.createdAt, ctx.timeZone()),
    description: copy.accounts.startDescription,
    postings: postingsOf(legs),
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }
  return { ok: true, value: { docs: [...accounts, transaction], kept: [transaction] } }
}

/**
 * The legs of a start, and the accounts the app makes for it: the opening account, and the
 * conversion account when it cost something. `cost` null: nothing said, so two postings.
 */
function startLegs(
  db: Database.Database,
  account: ShapeLeg,
  cost: number | null,
  made: Made,
): { legs: ShapeLeg[]; made: AccountDoc[] } {
  const opening = accountFor(db, OPENING, made)
  const openingLeg = { accountId: opening.id, cents: -account.cents, currency: account.currency }
  if (cost === null) return { legs: legsOf({ account, opening: openingLeg }), made: opening.made }
  const via = accountFor(db, CONVERSION, made)
  const paid = {
    accountId: opening.id,
    cents: account.cents < 0 ? cost : -cost,
    currency: HOME_CURRENCY,
  }
  return {
    legs: legsOf({ account, opening: paid, via: via.id }),
    made: [...opening.made, ...via.made],
  }
}

/** What a start cost, in cents: not an amount, or not above zero, is refused. */
function costOf(typed: string): Outcome<number> {
  const cents = parseTyped(typed)
  if (cents === null || cents <= 0) return failure('COST_INVALID', { cost: typed })
  return { ok: true, value: cents }
}

/** The account at `id`, where the file holds it and it's one I add to: a category isn't. */
function liveAddable(db: Database.Database, id: string): Outcome<AccountDoc> {
  const stored = getDocument(db, 'account', id)
  if (stored === null || !isAddable(stored.doc.kind)) {
    return failure('ACCOUNT_NOT_FOUND', { accountId: id })
  }
  if (stored.doc.deletedAt !== null) return failure('ACCOUNT_DELETED', { accountId: id })
  return { ok: true, value: stored.doc }
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
const zeroLeg = alias(postings, 'zero_leg')
const legAccount = alias(accounts, 'leg_account')

// Each live transaction with a zero leg on an account kept to a currency, and all of its legs.
// CROSS JOIN pins the order, from the account out, as `starts` does (see #608).
export const awaitingQuery = (orm: BetterSQLite3Database) =>
  orm
    .select({
      payer: accounts.id,
      transactionId: transactions.id,
      accountId: postings.accountId,
      cents: postings.amountCents,
      currency: postings.currency,
      kind: legAccount.kind,
    })
    .from(accounts)
    .crossJoin(zeroLeg)
    .crossJoin(transactions)
    .crossJoin(postings)
    .crossJoin(legAccount)
    .where(
      and(
        isNull(accounts.deletedAt),
        inArray(accounts.kind, [...ADDABLE_KINDS]),
        isNotNull(accounts.currency),
        eq(zeroLeg.accountId, accounts.id),
        eq(zeroLeg.currency, accounts.currency),
        eq(zeroLeg.amountCents, 0),
        eq(transactions.id, zeroLeg.transactionId),
        isNull(transactions.deletedAt),
        eq(postings.transactionId, transactions.id),
        eq(legAccount.id, postings.accountId),
      ),
    )

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
      transactionId: transactions.id,
      openingCents: openingLeg.amountCents,
      openingCurrency: openingLeg.currency,
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
  awaiting: awaitingQuery(orm).prepare(),
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

type Start = {
  cents: number
  currency: string
  date: string
  transactionId: string
  opening: { cents: number; currency: string }
}

/** What waits for its charge on each account, by id: each awaiting spend's `to`, below zero. */
function awaitingOf(db: Database.Database): Map<string, Money[]> {
  const sums = new Map<string, Map<string, number>>()
  for (const rows of Map.groupBy(statements(db).awaiting.all(), (r) => r.transactionId).values()) {
    const kinds = new Map(rows.map((r) => [r.accountId, r.kind]))
    const shape = shapeOf(rows, (accountId) => kinds.get(accountId))
    if (shape.shape !== 'awaiting') continue
    const payer = rows[0]?.payer
    if (payer === undefined || shape.from.accountId !== payer) continue
    const held = sums.get(payer) ?? new Map<string, number>()
    held.set(shape.to.currency, (held.get(shape.to.currency) ?? 0) - shape.to.cents)
    sums.set(payer, held)
  }
  return new Map(
    [...sums].map(([payer, held]) => [
      payer,
      [...held]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([currency, cents]) => ({ amount: format(cents), currency })),
    ]),
  )
}

/** Each account's starting balance, by id: the oldest, if sync ever brings two. */
function startsOf(db: Database.Database): Map<string, Start> {
  const found = new Map<string, Start>()
  const starts = statements(db).starts.all()
  for (const { accountId, openingCents, openingCurrency, ...start } of starts) {
    if (!found.has(accountId))
      found.set(accountId, {
        ...start,
        opening: { cents: openingCents, currency: openingCurrency },
      })
  }
  return found
}

/** Every live account I have or owe, by name without regard to case. */
export function listAccounts(db: Database.Database): ListedAccount[] {
  const starts = startsOf(db)
  const balances = balancesOf(db)
  const waitingOn = awaitingOf(db)
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
          ? {
              amount: format(sign * start.cents),
              currency: start.currency,
              date: start.date,
              // A start in another currency was given what it cost, in the home one.
              ...(start.opening.currency === start.currency
                ? {}
                : {
                    cost: {
                      amount: format(-sign * start.opening.cents),
                      currency: start.opening.currency,
                    },
                  }),
            }
          : null,
        balance: balances.get(id) ?? [],
        awaiting: waitingOn.get(id) ?? [],
      }
    })
    .sort((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
}

/** A cost said after the start: a new version of it, through the conversion account. */
export function costStart(ctx: Context, input: InputOf<'account.cost'>): Outcome<{ id: string }> {
  const { db } = ctx.ledger
  const { id } = input
  const live = liveAddable(db, id)
  if (!live.ok) return live
  const account = live.value
  const start = startsOf(db).get(id)
  if (
    start === undefined ||
    start.currency === HOME_CURRENCY ||
    start.opening.currency !== start.currency
  ) {
    return failure('START_NOT_COSTABLE', { accountId: id })
  }
  const cost = costOf(input.cost)
  if (!cost.ok) return cost

  const now = ctx.now()
  const stored = getDocument(db, 'transaction', start.transactionId)
  if (stored === null) return failure('TRANSACTION_NOT_FOUND', { id: start.transactionId })
  const { legs, made } = startLegs(
    db,
    { accountId: id, cents: start.cents, currency: start.currency },
    cost.value,
    { createdAt: now, deviceId: ctx.ledger.meta.deviceId },
  )
  const edited: TransactionDoc = { ...stored.doc, postings: postingsOf(legs) }
  const { applied, changes } = applyKeeping(ctx, [...made, edited], now, [edited])
  record(ctx, { action: 'cost', name: nameOf(account.path) }, changes, {
    spends: [],
    accounts: [id],
  })
  return idOf(applied, edited.id)
}

const byName = new Intl.Collator('en', { sensitivity: 'accent' })
/** Without regard to case, as the ledger matches paths. */
