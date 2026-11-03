// Adding an account on purpose, and the list of the ones I have and owe.

import { randomUUID } from 'node:crypto'
import { ADDABLE_KINDS, type AddableKind, classOf, isAddable } from '@have-fish/core/account-kind'
import { nameOf, pathFor } from '@have-fish/core/account-path'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { AccountDoc, LedgerDocument, TransactionDoc } from '@have-fish/core/documents'
import { format, parseTyped } from '@have-fish/core/money'
import { failure, type Outcome } from '@have-fish/core/outcome'
import type Database from 'better-sqlite3'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { copy } from '../../copy'
import type { InputOf, ListedAccount } from '../../shared/commands'
import { HOME_CURRENCY } from '../../shared/currency'
import type { Context } from '../context'
import { perConnection } from '../db/prepared'
import { accounts, postings, transactions } from '../db/schema'
import { getDocument } from '../ledger/store'
import { applyKeeping, record } from '../undo/steps'
import { accountFor, idOf } from './applied'

/** Where a starting balance comes from, as in hledger: made by the app on first use. */
const OPENING = { path: 'equity:opening', kind: 'opening' } as const

type Made = { createdAt: number; deviceId: string }

/**
 * An account under its kind's root, named as typed, in a batch of its own. A name I already
 * have is refused whatever its kind, since the list shows names without their roots.
 */
export function addAccount(ctx: Context, input: InputOf<'account.add'>): Outcome<{ id: string }> {
  const name = input.name.trim()
  if (name === '') return failure('ACCOUNT_NAME_EMPTY')
  const taken = listAccounts(ctx.ledger.db).find((a) => same(a.name, name))
  if (taken !== undefined) return failure('ACCOUNT_NAME_TAKEN', { name: taken.name })

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
 * The transaction that says what was in an account today, against `equity:opening`, with that
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
  const opening = accountFor(ctx.ledger.db, OPENING, made)
  const transaction: TransactionDoc = {
    type: 'transaction',
    id: randomUUID(),
    date: calendarDateAt(made.createdAt, ctx.timeZone()),
    description: copy.accounts.startDescription,
    postings: [
      { accountId: account.id, amount: format(signed), currency },
      { accountId: opening.id, amount: format(-signed), currency },
    ],
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }
  return { ok: true, value: { docs: [...opening.made, transaction], kept: [transaction] } }
}

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
  // Each live transaction with a leg on `equity:opening`: its other legs, oldest first.
  starts: orm
    .select({
      accountId: postings.accountId,
      cents: postings.amountCents,
      currency: postings.currency,
      date: transactions.date,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(openingLeg, eq(openingLeg.transactionId, postings.transactionId))
    .innerJoin(
      openingAccount,
      and(eq(openingAccount.id, openingLeg.accountId), eq(openingAccount.kind, 'opening')),
    )
    .where(and(isNull(transactions.deletedAt), ne(postings.accountId, openingLeg.accountId)))
    .orderBy(transactions.date, transactions.originCreatedAt, transactions.id)
    .prepare(),
}))

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
      }
    })
    .sort((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
}

const byName = new Intl.Collator('en', { sensitivity: 'accent' })
/** Without regard to case, as the ledger matches paths. */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
