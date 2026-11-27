// Writing down a spend, changing it, and taking it out. The list is `transactions.ts`.

import { randomUUID } from 'node:crypto'
import { isAddable } from '@have-fish/core/account-kind'
import { pathFor } from '@have-fish/core/account-path'
import { calendarDateAt, isCalendarDate } from '@have-fish/core/calendar-date'
import { fitsCurrency, isValidCurrency } from '@have-fish/core/currencies'
import type { AccountDoc, PostingDoc, TransactionDoc } from '@have-fish/core/documents'
import { format, parseTyped, splitCode, cents as toCents } from '@have-fish/core/money'
import { failure, type Outcome } from '@have-fish/core/outcome'
import { CONVERSION, INCOME, UNSORTED, WALLET } from '@have-fish/core/own-accounts'
import { amountOf, legsOf, type ShapeLeg, shapeOf } from '@have-fish/core/shapes'
import type Database from 'better-sqlite3'
import type { InputOf, To } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'
import { accountFor, idOf, postingsOf } from '../../commands/applied'
import type { Context } from '../../context'
import { getDocument, liveAccountAt } from '../../ledger/store'
import { applyKeeping, type Change, record } from '../../undo/steps'

/**
 * A spend from the account that paid to its category, a transfer to another account of mine, or
 * income from a source into an account of mine, on the day given or else today, in one batch
 * with any account it needs. It's in the currency typed, else the one the account paying is kept
 * to, else the one the account it goes to is kept to, else the home currency. Paid from an
 * account kept to another currency into a category, it goes through the conversion account, from
 * what the account was charged, or at zero while the charge is left empty.
 * Into an account of mine kept to another currency, or within one account that holds any, it
 * exchanges through the conversion account, from what arrived.
 */
export function writeSpend(ctx: Context, input: InputOf<'spend.write'>): Outcome<{ id: string }> {
  const amount = spendAmount(input.amount)
  if (!amount.ok) return amount
  const cents = amount.value
  const code = input.currency
  if (code !== undefined && !isValidCurrency(code)) {
    return failure('UNSUPPORTED_CURRENCY', { currency: code })
  }

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
  const sameAccount = from.value.id === ('account' in goesTo ? goesTo.account : null)
  const itself =
    sameAccount && input.arrived !== undefined && from.value.currency === null && code !== undefined
  if (sameAccount && !itself && input.arrived !== undefined) {
    return failure('ARRIVED_INVALID', { arrived: input.arrived })
  }
  const to: Outcome<End> = itself
    ? { ok: true, value: { id: from.value.id, currency: from.value.currency, made: [] } }
    : destination(ctx.ledger.db, goesTo, from.value.id, made)
  if (!to.ok) return to
  const currency = code ?? from.value.currency ?? to.value.currency ?? HOME_CURRENCY
  if (!fitsCurrency(cents, currency)) {
    return failure('AMOUNT_TOO_PRECISE', { amount: input.amount, currency })
  }
  const exchanging =
    !income &&
    'account' in goesTo &&
    (itself || (to.value.currency !== null && to.value.currency !== currency))
  const keptTo = income ? null : from.value.currency
  const converting = keptTo !== null && keptTo !== currency && 'category' in goesTo
  if (!converting && input.charged !== undefined) {
    return failure('CHARGED_INVALID', { charged: input.charged })
  }
  if (!exchanging && input.arrived !== undefined) {
    return failure('ARRIVED_INVALID', { arrived: input.arrived })
  }
  const into = { accountId: to.value.id, cents, currency }
  let legs: ShapeLeg[]
  let conversion: AccountDoc[] = []
  if (converting) {
    const charged: Outcome<number> = waits(input.charged)
      ? { ok: true, value: 0 }
      : chargedOf(input.charged, keptTo)
    if (!charged.ok) return charged
    const via = accountFor(ctx.ledger.db, CONVERSION, made)
    const paid = { accountId: from.value.id, cents: -charged.value, currency: keptTo }
    legs = legsOf({ from: paid, to: into, via: via.id })
    conversion = via.made
  } else if (exchanging) {
    const got = arrivedOf(input.arrived, to.value.currency, currency)
    if (!got.ok) return got
    const via = accountFor(ctx.ledger.db, CONVERSION, made)
    legs = legsOf({
      from: { accountId: from.value.id, cents: -cents, currency },
      to: { accountId: to.value.id, cents: got.value.cents, currency: got.value.currency },
      via: via.id,
    })
    conversion = via.made
  } else {
    legs = legsOf({ from: { accountId: from.value.id, cents: -cents, currency }, to: into })
  }
  const spend: TransactionDoc = {
    type: 'transaction',
    id: randomUUID(),
    date,
    description: input.description.trim(),
    postings: postingsOf(legs),
    deletedAt: null,
    origin: { source: 'manual', ...made },
  }

  const docs = [...from.value.made, ...to.value.made, ...conversion, spend]
  const { applied, changes } = applyKeeping(ctx, docs, now, [spend])
  record(ctx, { action: 'write', description: spend.description }, changes)
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
 * A new version of a spend with a new amount, description, and maybe currency, category or date.
 * The positive leg gets the amount and the other its negative; the id, account paying and origin
 * stay. A converted spend keeps its charge unless given a new one, and is a plain spend again in
 * the currency its account paid in.
 */
export function editSpend(ctx: Context, input: InputOf<'spend.edit'>): Outcome<{ id: string }> {
  const { edited, changes } = edit(ctx, input)
  record(ctx, { action: 'edit', description: input.description.trim() }, changes)
  return edited
}

/** An edit, applied, and what it changed for the history. */
function edit(
  ctx: Context,
  input: InputOf<'spend.edit'>,
): { edited: Outcome<{ id: string }>; changes: Change[] } {
  const amount = spendAmount(input.amount)
  if (!amount.ok) return { edited: amount, changes: [] }
  const cents = amount.value
  if (input.currency !== undefined && !isValidCurrency(input.currency)) {
    return { edited: failure('UNSUPPORTED_CURRENCY', { currency: input.currency }), changes: [] }
  }
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
  const shape = shapeOf(
    doc.postings.map((p) => ({ ...p, cents: toCents(p.amount) })),
    (accountId) => getDocument(db, 'account', accountId)?.doc.kind,
  )
  const simple = amountOf(shape)
  if (simple === null) return refused(failure('TRANSACTION_NOT_SIMPLE', { id }))
  const costed = shape.shape === 'start' && shape.via !== undefined
  // An exchange, or a start with its cost, keeps its amounts: only its description and day change.
  if (
    (shape.shape === 'exchange' || costed) &&
    (cents !== simple.cents ||
      (input.currency !== undefined && input.currency !== simple.currency) ||
      (shape.shape === 'exchange' && input.to !== undefined))
  ) {
    return refused(failure('TRANSACTION_NOT_SIMPLE', { id }))
  }
  const fx = shape.shape === 'converted' || shape.shape === 'awaiting' ? shape : null
  const currency = input.currency ?? simple.currency
  const keepsCharge = fx !== null && currency !== fx.from.currency
  if (!keepsCharge && input.charged !== undefined) {
    return refused(failure('CHARGED_INVALID', { charged: input.charged }))
  }
  // Onto an account of mine, a converted spend would be a transfer that converts.
  if (fx !== null && input.to !== undefined && 'account' in input.to) {
    return refused(failure('TRANSACTION_NOT_SIMPLE', { id }))
  }
  if (!fitsCurrency(cents, currency)) {
    return refused(failure('AMOUNT_TOO_PRECISE', { amount: input.amount, currency }))
  }
  let chargeCents = fx === null ? 0 : -fx.from.cents
  if (fx !== null && input.charged !== undefined) {
    const read = chargedOf(input.charged, fx.from.currency)
    if (!read.ok) return refused(read)
    chargeCents = read.value
  }

  const now = ctx.now()
  // Only a spend, transfer or income can go elsewhere: a start's and an other's accounts stay.
  const ends = 'to' in shape ? shape : null
  if (ends?.shape === 'income' && input.to !== undefined && 'category' in input.to) {
    return refused(failure('INCOME_NOT_TO_ACCOUNT', { accountId: ends.from.accountId }))
  }
  const into = ends?.to.accountId
  const moved =
    ends !== null && input.to !== undefined
      ? destination(db, input.to, ends.from.accountId, {
          createdAt: now,
          deviceId: ctx.ledger.meta.deviceId,
        })
      : { ok: true as const, value: { id: into, made: [] } }
  if (!moved.ok) return refused(moved)

  const description = input.description.trim()
  const date = input.date ?? doc.date
  // An unchanged save writes no version, so sync has nothing to send, and undo nothing to take back.
  if (
    currency === simple.currency &&
    cents === simple.cents &&
    description === doc.description &&
    moved.value.id === into &&
    date === doc.date &&
    (fx === null || chargeCents === -fx.from.cents)
  ) {
    return { edited: { ok: true, value: { id } }, changes: [] }
  }

  let postings: PostingDoc[]
  if (shape.shape === 'exchange' || costed) {
    postings = doc.postings
  } else if (fx === null) {
    postings = doc.postings.map((p) => {
      const positive = toCents(p.amount) > 0
      return {
        ...p,
        accountId: positive && moved.value.id !== undefined ? moved.value.id : p.accountId,
        amount: format(positive ? cents : -cents),
        currency,
      }
    })
  } else if (keepsCharge) {
    // Found by account and currency as it was before the edit, each posting keeps its place.
    const matches = (p: PostingDoc, accountId: string, postedIn: string) =>
      p.accountId === accountId && p.currency === postedIn
    postings = doc.postings.map((p) => {
      if (matches(p, fx.to.accountId, fx.to.currency)) {
        return { ...p, accountId: moved.value.id ?? p.accountId, amount: format(cents), currency }
      }
      if (matches(p, fx.via, fx.to.currency)) return { ...p, amount: format(-cents), currency }
      if (matches(p, fx.via, fx.from.currency)) return { ...p, amount: format(chargeCents) }
      return { ...p, amount: format(-chargeCents) }
    })
  } else {
    const to = { accountId: moved.value.id ?? fx.to.accountId, cents, currency }
    postings = postingsOf(
      legsOf({ from: { accountId: fx.from.accountId, cents: -cents, currency }, to }),
    )
  }
  const edited: TransactionDoc = { ...doc, date, description, postings }
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
  record(ctx, { action: 'remove', description: doc.description }, changes)
  return idOf(applied, id)
}

/** What the account paying was charged, as typed, in cents of the one currency it holds. */
function chargedOf(typed: string | undefined, currency: string): Outcome<number> {
  if (typed === undefined) return failure('CHARGED_INVALID', { charged: '' })
  const cents = spendAmount(typed)
  if (!cents.ok || !fitsCurrency(cents.value, currency)) {
    return failure('CHARGED_INVALID', { charged: typed })
  }
  return cents
}

/** A charge left empty: the spend waits for the one the bank posts. */
const waits = (typed: string | undefined) => typed === undefined || typed.trim() === ''

/** What arrived, as typed: in its code, else its account's lock, and never the one sent. */
function arrivedOf(
  typed: string | undefined,
  keptTo: string | null,
  sent: string,
): Outcome<{ cents: number; currency: string }> {
  if (typed === undefined) return failure('ARRIVED_INVALID', { arrived: '' })
  const { amount, currency: code } = splitCode(typed)
  const currency = code ?? keptTo
  if (
    currency === null ||
    !isValidCurrency(currency) ||
    currency === sent ||
    (keptTo !== null && currency !== keptTo)
  ) {
    return failure('ARRIVED_INVALID', { arrived: typed })
  }
  const cents = spendAmount(amount)
  if (!cents.ok || !fitsCurrency(cents.value, currency)) {
    return failure('ARRIVED_INVALID', { arrived: typed })
  }
  return { ok: true, value: { cents: cents.value, currency } }
}

/** A spend's amount as typed, in cents: a number, and more than zero. */
function spendAmount(typed: string): Outcome<number> {
  const cents = parseTyped(typed)
  if (cents === null) return failure('AMOUNT_INVALID', { amount: typed })
  if (cents <= 0) return failure('AMOUNT_NOT_POSITIVE', { amount: typed })
  return { ok: true, value: cents }
}
