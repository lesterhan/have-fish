import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { describe, expect, test } from 'vitest'
import type { Changed } from '../../shared/commands'
import { HOME_CURRENCY } from '../../shared/currency'
import { contextFor, type Time } from '../context'
import { loadClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
import { applyLocal } from '../ledger/apply'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from '../ledger/fixtures'
import { getDocument } from '../ledger/store'
import { redoLast, undoLast } from '../undo/steps'
import { addAccount, listAccounts } from './accounts'
import { listCategories, listIncome } from './categories'
import { assumedFrom, editSpend, removeSpend, writeSpend } from './spends'
import { listTransactions } from './transactions'

// 03:00 on the 30th in UTC, still the evening of the 29th in Vancouver.
const LATE = Date.UTC(2026, 9, 30, 3)
const ZONE = 'America/Vancouver'

function setup(ledger = tempLedger()) {
  const announced: Changed[][] = []
  const clock: Time & { at: number } = { at: LATE, now: () => clock.at, timeZone: () => ZONE }
  const ctx = contextFor(ledger, (changed) => announced.push(changed), clock)
  return { ledger, ctx, announced, clock }
}

const count = (ledger: Ledger, table: string) =>
  ledger.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()

/** The live account at `path`, as stored. */
function accountAt(ledger: Ledger, path: string): AccountDoc {
  const ids = ledger.db
    .prepare('SELECT id FROM accounts WHERE path = ? AND deletedAt IS NULL')
    .pluck()
    .all(path) as string[]
  expect(ids).toHaveLength(1)
  const stored = getDocument(ledger.db, 'account', ids[0] as string)
  if (stored === null) throw new Error(`no account at ${path}`)
  return stored.doc
}

function spendOf(ledger: Ledger, id: string): TransactionDoc {
  const stored = getDocument(ledger.db, 'transaction', id)
  if (stored === null) throw new Error(`no transaction ${id}`)
  return stored.doc
}

describe('writeSpend', () => {
  test('writes a balanced spend from the wallet to unsorted, dated today where you are', () => {
    const { ledger, ctx } = setup()

    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))

    const wallet = accountAt(ledger, 'assets:cash')
    const unsorted = accountAt(ledger, 'expenses:unsorted')
    expect(spendOf(ledger, id)).toEqual({
      type: 'transaction',
      id,
      date: '2026-10-29',
      description: 'Coffee',
      postings: [
        { accountId: unsorted.id, amount: '4.50', currency: HOME_CURRENCY },
        { accountId: wallet.id, amount: '-4.50', currency: HOME_CURRENCY },
      ],
      deletedAt: null,
      origin: { source: 'manual', createdAt: LATE, deviceId: ledger.meta.deviceId },
    })
    expect(calendarDateAt(LATE, 'UTC')).toBe('2026-10-30')
  })

  test('the first spend makes the wallet and the unsorted category, as the app', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))

    const made = { source: 'system', createdAt: LATE, deviceId: ledger.meta.deviceId }
    expect(accountAt(ledger, 'assets:cash')).toMatchObject({
      kind: 'cash',
      currency: null,
      origin: made,
    })
    expect(accountAt(ledger, 'expenses:unsorted')).toMatchObject({
      kind: 'category',
      currency: null,
      origin: made,
    })
  })

  test('later spends use the same two accounts', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ok(writeSpend(ctx, { amount: '12', description: 'Lunch' }))

    expect(count(ledger, 'accounts')).toBe(2)
    expect(count(ledger, 'transactions')).toBe(2)
  })

  test('an account already at the path is used, whoever made it', () => {
    const ledger = tempLedger()
    const wallet = anAccount()
    ok(applyLocal(ledger, [wallet], NOW))
    const { ctx } = setup(ledger)

    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))

    expect(spendOf(ledger, id).postings[1]?.accountId).toBe(wallet.id)
  })

  test('a deleted wallet is never posted to: the spend gets a new one', () => {
    const ledger = tempLedger()
    const old = anAccount()
    ok(applyLocal(ledger, [old], NOW))
    ok(applyLocal(ledger, [{ ...old, deletedAt: NOW }], NOW))
    const { ctx } = setup(ledger)

    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))

    const wallet = accountAt(ledger, 'assets:cash')
    expect(wallet.id).not.toBe(old.id)
    expect(spendOf(ledger, id).postings[1]?.accountId).toBe(wallet.id)
  })

  test('the amount is stored in its canonical form, and the description trimmed', () => {
    const { ledger, ctx } = setup()

    const { id } = ok(writeSpend(ctx, { amount: ' 4.5 ', description: '  Coffee \n' }))

    const spend = spendOf(ledger, id)
    expect(spend.postings.map((p) => p.amount)).toEqual(['4.50', '-4.50'])
    expect(spend.description).toBe('Coffee')
  })

  test('thousands typed with commas read as one amount', () => {
    const { ledger, ctx } = setup()

    const { id } = ok(writeSpend(ctx, { amount: '1,234.50', description: 'Rent' }))

    expect(spendOf(ledger, id).postings.map((p) => p.amount)).toEqual(['1234.50', '-1234.50'])
  })

  test('no description is fine', () => {
    const { ledger, ctx } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: '' }))
    expect(spendOf(ledger, id).description).toBe('')
  })

  test.each(['abc', '', '  ', '4.50 CAD', '$4.50', '4,50', '1e12'])(
    '%j is not an amount: nothing is saved or announced',
    (amount) => {
      const { ledger, ctx, announced } = setup()

      const outcome = writeSpend(ctx, { amount, description: 'Coffee' })

      expect(outcome).toEqual({
        ok: false,
        failure: { code: 'AMOUNT_INVALID', details: { amount } },
      })
      expect(count(ledger, 'transactions')).toBe(0)
      expect(count(ledger, 'accounts')).toBe(0)
      expect(loadClock(ledger.db)).toEqual({ wallMs: 0, counter: 0 })
      ctx.flush()
      expect(announced).toEqual([])
    },
  )

  test.each(['0', '-4.50', '0.004'])('%j is not more than zero: nothing is saved', (amount) => {
    const { ledger, ctx } = setup()

    const outcome = writeSpend(ctx, { amount, description: 'Coffee' })

    expect(outcome).toEqual({
      ok: false,
      failure: { code: 'AMOUNT_NOT_POSITIVE', details: { amount } },
    })
    expect(count(ledger, 'transactions')).toBe(0)
  })

  test('a refusal from the ledger comes back without its place in the batch', () => {
    const { ctx } = setup()

    const outcome = writeSpend(ctx, { amount: '4.50', description: 'caf\ud800' })

    expect(outcome).toEqual({
      ok: false,
      failure: {
        code: 'DOCUMENT_MALFORMED',
        details: { path: 'description', issue: 'invalid_format' },
      },
    })
  })

  test('one save is announced once: the accounts it made, then the spend', () => {
    const { ledger, ctx, announced } = setup()

    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))

    ctx.flush()
    expect(announced).toEqual([
      [
        { type: 'account', id: accountAt(ledger, 'assets:cash').id },
        { type: 'account', id: accountAt(ledger, 'expenses:unsorted').id },
        { type: 'transaction', id },
      ],
    ])
  })
})

describe('writing a spend from an account I picked', () => {
  test('comes out of that account, and goes to unsorted', () => {
    const { ledger, ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))

    const { id } = ok(writeSpend(ctx, { amount: '30', description: 'Dinner', from: visa.id }))

    const unsorted = accountAt(ledger, 'expenses:unsorted')
    expect(spendOf(ledger, id).postings).toEqual([
      { accountId: unsorted.id, amount: '30.00', currency: 'CAD' },
      { accountId: visa.id, amount: '-30.00', currency: 'CAD' },
    ])
    expect(listTransactions(ledger.db)[0]?.from).toBe('visa')
  })

  test('the wallet is not made when another account paid', () => {
    const { ledger, ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))

    ok(writeSpend(ctx, { amount: '30', description: 'Dinner', from: visa.id }))

    expect(listAccounts(ledger.db).map((a) => a.name)).toEqual(['visa'])
  })

  test('an account kept to one currency pays in it; one that holds any pays in CAD', () => {
    const { ledger, ctx } = setup()
    const chequing = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'USD' }))
    const wise = ok(addAccount(ctx, { name: 'wise', kind: 'bank', currency: null }))

    const usd = ok(writeSpend(ctx, { amount: '5', description: 'Gum', from: chequing.id }))
    const cad = ok(writeSpend(ctx, { amount: '5', description: 'Gum', from: wise.id }))

    expect(spendOf(ledger, usd.id).postings.map((p) => p.currency)).toEqual(['USD', 'USD'])
    expect(spendOf(ledger, cad.id).postings.map((p) => p.currency)).toEqual([
      HOME_CURRENCY,
      HOME_CURRENCY,
    ])
  })

  test('the account is remembered by this machine once the spend is saved', () => {
    const { ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))

    ok(writeSpend(ctx, { amount: '30', description: 'Dinner', from: visa.id }))

    expect(ctx.machine.lastFrom()).toBe(visa.id)
  })

  test('with none picked, it comes out of the account used last', () => {
    const { ledger, ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(writeSpend(ctx, { amount: '30', description: 'Dinner', from: visa.id }))

    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', from: null }))

    expect(spendOf(ledger, id).postings[1]?.accountId).toBe(visa.id)
  })

  test('the first spend with none picked makes the wallet, and remembers it', () => {
    const { ledger, ctx } = setup()

    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', from: null }))

    expect(ctx.machine.lastFrom()).toBe(accountAt(ledger, 'assets:cash').id)
  })

  test.each([
    ['a category', (ledger: Ledger) => accountAt(ledger, 'expenses:unsorted').id],
    ['an account the file does not hold', () => '7d1c2f3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'],
  ])('%s cannot pay: refused, nothing saved, nothing remembered', (_, idIn) => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const wallet = ctx.machine.lastFrom()
    const step = ctx.history.nextUndo()
    const id = idIn(ledger)

    expect(writeSpend(ctx, { amount: '1', description: 'Gum', from: id })).toEqual({
      ok: false,
      failure: { code: 'ACCOUNT_NOT_FOUND', details: { accountId: id } },
    })
    expect(listTransactions(ledger.db)).toHaveLength(1)
    expect(ctx.machine.lastFrom()).toBe(wallet)
    expect(ctx.history.nextUndo()).toBe(step)
  })

  test('an account taken back cannot pay', () => {
    const { ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(undoLast(ctx))

    expect(writeSpend(ctx, { amount: '1', description: 'Gum', from: visa.id })).toEqual({
      ok: false,
      failure: { code: 'ACCOUNT_DELETED', details: { accountId: visa.id } },
    })
  })

  test('a spend refused for its amount remembers nothing', () => {
    const { ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))

    writeSpend(ctx, { amount: 'abc', description: 'Gum', from: visa.id })

    expect(ctx.machine.lastFrom()).toBeNull()
  })

  test('a spend the ledger refuses remembers nothing', () => {
    const { ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))

    const refused = writeSpend(ctx, { amount: '1', description: 'caf\ud800', from: visa.id })

    expect(refused.ok).toBe(false)
    expect(ctx.machine.lastFrom()).toBeNull()
  })
})

describe('assumedFrom', () => {
  test('nothing in a new ledger: the first spend makes the wallet', () => {
    const { ctx } = setup()
    expect(assumedFrom(ctx)).toEqual({ id: null })
  })

  test('the wallet, once there is one and nothing else has been used', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ctx.machine.usedFrom('00000000-0000-4000-8000-000000000000')

    expect(assumedFrom(ctx)).toEqual({ id: accountAt(ledger, 'assets:cash').id })
  })

  test('the account used last', () => {
    const { ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(writeSpend(ctx, { amount: '30', description: 'Dinner', from: visa.id }))

    expect(assumedFrom(ctx)).toEqual({ id: visa.id })
  })

  test('never a category, whatever this machine remembers', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ctx.machine.usedFrom(accountAt(ledger, 'expenses:unsorted').id)

    expect(assumedFrom(ctx)).toEqual({ id: accountAt(ledger, 'assets:cash').id })
  })

  test('the wallet again, once the account used last is gone', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ctx.machine.usedFrom(visa.id)
    ok(undoLast(ctx))

    expect(assumedFrom(ctx)).toEqual({ id: accountAt(ledger, 'assets:cash').id })
  })
})

describe('editSpend', () => {
  /** A spend written down at LATE, and the ledger as it was just after. */
  function written() {
    const setup_ = setup()
    const { id } = ok(writeSpend(setup_.ctx, { amount: '4.50', description: 'Coffee' }))
    const before = getDocument(setup_.ledger.db, 'transaction', id)
    if (before === null) throw new Error('not written')
    setup_.ctx.flush()
    setup_.announced.length = 0
    return { ...setup_, id, before }
  }

  test('the new amount goes on both legs, with the new description; nothing else changes', () => {
    const { ledger, ctx, id, before } = written()

    ok(editSpend(ctx, { id, amount: '5', description: 'Coffee, large' }))

    const after = getDocument(ledger.db, 'transaction', id)
    expect(after?.doc).toEqual({
      ...before.doc,
      description: 'Coffee, large',
      postings: [
        { ...before.doc.postings[0], amount: '5.00' },
        { ...before.doc.postings[1], amount: '-5.00' },
      ],
    })
    expect(after?.version).not.toEqual(before.version)
    expect(count(ledger, 'transactions')).toBe(1)
  })

  test('the date stays the day it was written, whatever day it is edited', () => {
    const { ledger, ctx, clock, id, before } = written()
    clock.at += 3 * 86_400_000

    ok(editSpend(ctx, { id, amount: '5', description: 'Coffee' }))

    expect(spendOf(ledger, id).date).toBe(before.doc.date)
  })

  test('whichever order its legs are in, the positive one gets the amount', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spend = aSpend(cash.id, food.id, '12.50')
    ok(applyLocal(ledger, [cash, food, spend], NOW))
    const { ctx } = setup(ledger)

    ok(editSpend(ctx, { id: spend.id, amount: '20', description: 'Groceries' }))

    expect(spendOf(ledger, spend.id).postings).toEqual([
      { accountId: cash.id, amount: '-20.00', currency: 'CAD' },
      { accountId: food.id, amount: '20.00', currency: 'CAD' },
    ])
  })

  test('the amount is stored in its canonical form, and the description trimmed', () => {
    const { ledger, ctx, id } = written()

    ok(editSpend(ctx, { id, amount: ' 5.5 ', description: '  Tea \n' }))

    const spend = spendOf(ledger, id)
    expect(spend.postings.map((p) => p.amount)).toEqual(['5.50', '-5.50'])
    expect(spend.description).toBe('Tea')
  })

  test('one edit is announced once, as the transaction', () => {
    const { ctx, announced, id } = written()

    ok(editSpend(ctx, { id, amount: '5', description: 'Coffee' }))

    ctx.flush()
    expect(announced).toEqual([[{ type: 'transaction', id }]])
  })

  test.each([
    ['the same', '4.50', 'Coffee'],
    ['written another way', '4.5', ' Coffee '],
  ])('%s amount and description: nothing is written or announced', (_, amount, description) => {
    const { ledger, ctx, announced, id, before } = written()
    const clock = loadClock(ledger.db)

    expect(editSpend(ctx, { id, amount, description })).toEqual({ ok: true, value: { id } })

    expect(getDocument(ledger.db, 'transaction', id)).toEqual(before)
    expect(loadClock(ledger.db)).toEqual(clock)
    ctx.flush()
    expect(announced).toEqual([])
  })

  test.each([
    ['abc', 'AMOUNT_INVALID'],
    ['', 'AMOUNT_INVALID'],
    ['0', 'AMOUNT_NOT_POSITIVE'],
    ['-5', 'AMOUNT_NOT_POSITIVE'],
  ])('%j: refused with %s, and nothing changes', (amount, code) => {
    const { ledger, ctx, announced, id, before } = written()

    expect(editSpend(ctx, { id, amount, description: 'Tea' })).toEqual({
      ok: false,
      failure: { code, details: { amount } },
    })
    expect(getDocument(ledger.db, 'transaction', id)).toEqual(before)
    ctx.flush()
    expect(announced).toEqual([])
  })

  test('a transaction the file does not hold', () => {
    const { ctx } = written()
    const id = '00000000-0000-4000-8000-000000000001'

    expect(editSpend(ctx, { id, amount: '5', description: 'Tea' })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_FOUND', details: { id } },
    })
  })

  test('a removed transaction stays removed', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spend = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [cash, food, spend], NOW))
    ok(applyLocal(ledger, [tombstoneOf(spend)], NOW))
    const { ctx } = setup(ledger)

    expect(editSpend(ctx, { id: spend.id, amount: '5', description: 'Tea' })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_DELETED', details: { id: spend.id } },
    })
    expect(spendOf(ledger, spend.id).deletedAt).toBe(NOW)
  })

  test('a split has no one amount to set', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const fun = anAccount({ path: 'expenses:fun', kind: 'category' })
    const split = aSpend(cash.id, food.id, '10.00', {
      postings: [
        { accountId: cash.id, amount: '-10.00', currency: 'CAD' },
        { accountId: food.id, amount: '6.00', currency: 'CAD' },
        { accountId: fun.id, amount: '4.00', currency: 'CAD' },
      ],
    })
    ok(applyLocal(ledger, [cash, food, fun, split], NOW))
    const { ctx } = setup(ledger)

    expect(editSpend(ctx, { id: split.id, amount: '5', description: 'Tea' })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id: split.id } },
    })
    expect(spendOf(ledger, split.id)).toEqual(split)
  })

  test('a refusal from the ledger comes back without its place in the batch', () => {
    const { ctx, id } = written()

    expect(editSpend(ctx, { id, amount: '5', description: 'caf\ud800' })).toEqual({
      ok: false,
      failure: {
        code: 'DOCUMENT_MALFORMED',
        details: { path: 'description', issue: 'invalid_format' },
      },
    })
  })
})

describe('a spend from another day', () => {
  test('saved on the day I set, whatever day it is', () => {
    const { ledger, ctx } = setup()

    const { id } = ok(
      writeSpend(ctx, { amount: '4.50', description: 'Coffee', date: '2026-10-27' }),
    )

    expect(spendOf(ledger, id).date).toBe('2026-10-27')
  })

  test('none set, or left empty: today where I am', () => {
    const { ledger, ctx } = setup()

    const none = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const empty = ok(writeSpend(ctx, { amount: '4.50', description: 'Tea', date: '' }))

    expect(spendOf(ledger, none.id).date).toBe('2026-10-29')
    expect(spendOf(ledger, empty.id).date).toBe('2026-10-29')
  })

  test('a day ahead is fine: a bill I already know about', () => {
    const { ledger, ctx } = setup()

    const { id } = ok(writeSpend(ctx, { amount: '80', description: 'Rent', date: '2026-11-01' }))

    expect(spendOf(ledger, id).date).toBe('2026-11-01')
  })

  test('sorts into place in the list: by its day, then newest made first', () => {
    const { ledger, ctx, clock } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    clock.at += 60_000
    ok(writeSpend(ctx, { amount: '12', description: 'Lunch', date: '2026-10-28' }))
    clock.at += 60_000
    ok(writeSpend(ctx, { amount: '3', description: 'Tea', date: '2026-10-28' }))

    expect(listTransactions(ledger.db).map((t) => [t.description, t.date])).toEqual([
      ['Coffee', '2026-10-29'],
      ['Tea', '2026-10-28'],
      ['Lunch', '2026-10-28'],
    ])
  })

  test.each(['2026-02-30', '2026-13-01', '27/10/2026', 'yesterday', ' ', '2026-1-1'])(
    '%j is not a day: refused, and nothing is saved or remembered',
    (date) => {
      const { ledger, ctx, announced } = setup()

      const outcome = writeSpend(ctx, { amount: '4.50', description: 'Coffee', date })

      expect(outcome).toEqual({ ok: false, failure: { code: 'DATE_INVALID', details: { date } } })
      expect(count(ledger, 'transactions')).toBe(0)
      expect(count(ledger, 'accounts')).toBe(0)
      ctx.flush()
      expect(announced).toEqual([])
      expect(ctx.machine.lastFrom()).toBeNull()
    },
  )

  test('an amount that is wrong too is said first, as the field before it', () => {
    const { ctx } = setup()

    const outcome = writeSpend(ctx, { amount: 'abc', description: 'Coffee', date: 'nope' })

    expect(outcome).toMatchObject({ ok: false, failure: { code: 'AMOUNT_INVALID' } })
  })
})

describe('moving a spend to another day', () => {
  function written() {
    const setup_ = setup()
    const { id } = ok(writeSpend(setup_.ctx, { amount: '4.50', description: 'Coffee' }))
    const before = getDocument(setup_.ledger.db, 'transaction', id)
    if (before === null) throw new Error('not written')
    setup_.ctx.flush()
    setup_.announced.length = 0
    return { ...setup_, id, before }
  }

  test('only the date changes', () => {
    const { ledger, ctx, id, before } = written()

    ok(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', date: '2026-10-25' }))

    expect(spendOf(ledger, id)).toEqual({ ...before.doc, date: '2026-10-25' })
  })

  test('left out, or the same day: the date stays', () => {
    const { ledger, ctx, announced, id, before } = written()

    ok(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', date: before.doc.date }))
    expect(getDocument(ledger.db, 'transaction', id)).toEqual(before)
    ctx.flush()
    expect(announced).toEqual([])

    ok(editSpend(ctx, { id, amount: '5', description: 'Coffee' }))
    expect(spendOf(ledger, id).date).toBe(before.doc.date)
  })

  test('it sorts into its new place in the list', () => {
    const { ledger, ctx, clock, id } = written()
    clock.at += 60_000
    const tea = ok(writeSpend(ctx, { amount: '3', description: 'Tea' }))
    expect(listTransactions(ledger.db).map((t) => t.id)).toEqual([tea.id, id])

    ok(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', date: '2026-10-30' }))

    expect(listTransactions(ledger.db).map((t) => t.id)).toEqual([id, tea.id])
  })

  test('undo puts it back on its day; redo moves it again', () => {
    const { ledger, ctx, id, before } = written()
    ok(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', date: '2026-10-25' }))

    ok(undoLast(ctx))
    expect(spendOf(ledger, id).date).toBe(before.doc.date)
    ok(redoLast(ctx))
    expect(spendOf(ledger, id).date).toBe('2026-10-25')
  })

  test.each(['', '2026-02-30', 'monday'])('%j is not a day: refused, and it stays', (date) => {
    const { ledger, ctx, announced, id, before } = written()

    expect(editSpend(ctx, { id, amount: '5', description: 'Tea', date })).toEqual({
      ok: false,
      failure: { code: 'DATE_INVALID', details: { date } },
    })
    expect(getDocument(ledger.db, 'transaction', id)).toEqual(before)
    ctx.flush()
    expect(announced).toEqual([])
  })
})

describe('listTransactions', () => {
  test('lists nothing in a new ledger', () => {
    expect(listTransactions(tempLedger().db)).toEqual([])
  })

  test('newest first, each with what it spent', () => {
    const { ledger, ctx, clock } = setup()
    const coffee = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    clock.at += 60_000
    const lunch = ok(writeSpend(ctx, { amount: '12', description: 'Lunch' }))

    expect(listTransactions(ledger.db)).toEqual([
      {
        id: lunch.id,
        date: '2026-10-29',
        description: 'Lunch',
        amounts: [{ amount: '12.00', currency: 'CAD' }],
        simple: { amount: '12.00', currency: 'CAD' },
        from: 'cash',
        to: 'unsorted',
        fromPath: 'assets:cash',
        toPath: 'expenses:unsorted',
        legs: [
          { amount: '12.00', currency: 'CAD', path: 'expenses:unsorted' },
          { amount: '-12.00', currency: 'CAD', path: 'assets:cash' },
        ],
      },
      {
        id: coffee.id,
        date: '2026-10-29',
        description: 'Coffee',
        amounts: [{ amount: '4.50', currency: 'CAD' }],
        simple: { amount: '4.50', currency: 'CAD' },
        from: 'cash',
        to: 'unsorted',
        fromPath: 'assets:cash',
        toPath: 'expenses:unsorted',
        legs: [
          { amount: '4.50', currency: 'CAD', path: 'expenses:unsorted' },
          { amount: '-4.50', currency: 'CAD', path: 'assets:cash' },
        ],
      },
    ])
  })

  test('by date first: a later day lists above one written after it', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const today = aSpend(cash.id, food.id, '1.00', { date: '2026-10-29' })
    const yesterday = aSpend(cash.id, food.id, '2.00', {
      date: '2026-10-28',
      origin: { ...today.origin, createdAt: NOW + 1 },
    })
    ok(applyLocal(ledger, [cash, food, today, yesterday], NOW))

    expect(listTransactions(ledger.db).map((t) => t.id)).toEqual([today.id, yesterday.id])
  })

  test('leaves out a deleted transaction', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const kept = aSpend(cash.id, food.id)
    const gone = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [cash, food, kept, gone], NOW))
    ok(applyLocal(ledger, [tombstoneOf(gone)], NOW))

    expect(listTransactions(ledger.db).map((t) => t.id)).toEqual([kept.id])
  })

  test('a conversion shows what moved in each currency', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const fx = anAccount({ path: 'equity:conversion', kind: 'conversion' })
    const ramen = aSpend(cash.id, food.id, '10.00', {
      postings: [
        { accountId: cash.id, amount: '-10.00', currency: 'CAD' },
        { accountId: fx.id, amount: '10.00', currency: 'CAD' },
        { accountId: fx.id, amount: '-1100', currency: 'JPY' },
        { accountId: food.id, amount: '1100', currency: 'JPY' },
      ],
    })
    ok(applyLocal(ledger, [cash, food, fx, ramen], NOW))

    expect(listTransactions(ledger.db)[0]).toMatchObject({
      amounts: [
        { amount: '10.00', currency: 'CAD' },
        { amount: '1100.00', currency: 'JPY' },
      ],
      simple: null,
      from: null,
    })
  })

  test('a split in one currency shows its total, and has no one amount', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const fun = anAccount({ path: 'expenses:fun', kind: 'category' })
    const split = aSpend(cash.id, food.id, '10.00', {
      postings: [
        { accountId: cash.id, amount: '-10.00', currency: 'CAD' },
        { accountId: food.id, amount: '6.00', currency: 'CAD' },
        { accountId: fun.id, amount: '4.00', currency: 'CAD' },
      ],
    })
    ok(applyLocal(ledger, [cash, food, fun, split], NOW))

    expect(listTransactions(ledger.db)[0]).toMatchObject({
      amounts: [{ amount: '10.00', currency: 'CAD' }],
      simple: null,
      from: null,
    })
  })

  test('a spend lists the account it came out of by name, whichever leg is first', () => {
    const ledger = tempLedger()
    const visa = anAccount({ path: 'liabilities:visa', kind: 'card' })
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const dinner = aSpend(visa.id, food.id, '30.00', {
      postings: [
        { accountId: visa.id, amount: '-30.00', currency: 'CAD' },
        { accountId: food.id, amount: '30.00', currency: 'CAD' },
      ],
    })
    ok(applyLocal(ledger, [visa, food, dinner], NOW))

    expect(listTransactions(ledger.db)[0]?.from).toBe('visa')
  })

  test('a transaction that moved nothing lists with no amounts', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    ok(applyLocal(ledger, [cash, food, aSpend(cash.id, food.id, '0.00')], NOW))

    expect(listTransactions(ledger.db)[0]).toMatchObject({ amounts: [], simple: null, from: null })
  })
})

describe('removeSpend', () => {
  test('leaves a tombstone, so the spend is in no list and no sum', () => {
    const { ledger, ctx, clock } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ok(writeSpend(ctx, { amount: '12', description: 'Lunch' }))
    clock.at += 1000

    expect(removeSpend(ctx, { id })).toEqual({ ok: true, value: { id } })

    const stored = spendOf(ledger, id)
    expect(stored.deletedAt).toBe(clock.at)
    expect(stored.postings).toEqual([])
    expect(listTransactions(ledger.db).map((t) => t.description)).toEqual(['Lunch'])
    expect(
      ledger.db.prepare('SELECT count(*) FROM postings WHERE transactionId = ?').pluck().get(id),
    ).toBe(0)
  })

  test('keeps everything else about it, for undo to write back', () => {
    const { ledger, ctx } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const before = spendOf(ledger, id)
    ok(removeSpend(ctx, { id }))
    const { postings: _, deletedAt: __, ...kept } = spendOf(ledger, id)
    const { postings: ___, deletedAt: ____, ...was } = before
    expect(kept).toEqual(was)
  })

  test('is one step, named for the spend', () => {
    const { ctx } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ok(removeSpend(ctx, { id }))
    expect(ctx.history.nextUndo()?.name).toEqual({ kind: 'remove', description: 'Coffee' })
  })

  test('a spend that is not there, or already removed, is refused and adds no step', () => {
    const { ctx } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ok(removeSpend(ctx, { id }))
    const missing = '00000000-0000-4000-8000-000000000009'

    expect(removeSpend(ctx, { id })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_DELETED', details: { id } },
    })
    expect(removeSpend(ctx, { id: missing })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_FOUND', details: { id: missing } },
    })
    expect(ctx.history.nextUndo()?.name.kind).toBe('remove')
  })
})

describe('a spend’s category', () => {
  test('one I have never used is made, as mine, in the same batch as the spend', () => {
    const { ledger, ctx, announced } = setup()

    const { id } = ok(
      writeSpend(ctx, { amount: '12', description: 'Lunch', to: { category: 'food' } }),
    )

    const food = accountAt(ledger, 'expenses:food')
    expect(food).toMatchObject({ kind: 'category', currency: null, origin: { source: 'manual' } })
    expect(spendOf(ledger, id).postings[0]?.accountId).toBe(food.id)
    expect(listTransactions(ledger.db)[0]?.to).toBe('food')
    ctx.flush()
    expect(announced.at(-1)?.map((c) => c.type)).toEqual(['account', 'account', 'transaction'])
  })

  test('one I have used is used again, whatever its case', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '12', description: 'Lunch', to: { category: 'food' } }))

    const { id } = ok(
      writeSpend(ctx, { amount: '3', description: 'Tea', to: { category: ' FOOD ' } }),
    )

    expect(spendOf(ledger, id).postings[0]?.accountId).toBe(accountAt(ledger, 'expenses:food').id)
    expect(count(ledger, "accounts WHERE kind = 'category'")).toBe(1)
  })

  test('a colon nests it, as I typed it', () => {
    const { ledger, ctx } = setup()

    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', to: { category: 'food:coffee' } }))

    expect(accountAt(ledger, 'expenses:food:coffee').kind).toBe('category')
    expect(listTransactions(ledger.db)[0]?.to).toBe('food:coffee')
  })

  test('none is unsorted', () => {
    const { ledger, ctx } = setup()

    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', to: { category: '  ' } }))

    expect(listTransactions(ledger.db)[0]?.to).toBe('unsorted')
  })

  test('a name with an empty part is refused by the ledger, and nothing is made', () => {
    const { ledger, ctx } = setup()

    expect(writeSpend(ctx, { amount: '1', description: 'x', to: { category: 'food::x' } })).toEqual(
      {
        ok: false,
        failure: { code: 'PATH_INVALID', details: { path: 'expenses:food::x' } },
      },
    )
    expect(count(ledger, 'accounts')).toBe(0)
  })

  test('undo takes the spend back and leaves the category, which then isn’t offered', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '12', description: 'Lunch', to: { category: 'food' } }))

    ok(undoLast(ctx))

    expect(accountAt(ledger, 'expenses:food').deletedAt).toBeNull()
    expect(listCategories(ledger.db)).toEqual([])
  })
})

describe('changing a spend’s category', () => {
  test('moves it, to a new one or one I have', () => {
    const { ledger, ctx } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '12', description: 'Lunch' }))

    ok(editSpend(ctx, { id, amount: '12', description: 'Lunch', to: { category: 'food' } }))

    const food = accountAt(ledger, 'expenses:food')
    expect(spendOf(ledger, id).postings).toEqual([
      { accountId: food.id, amount: '12.00', currency: 'CAD' },
      { accountId: accountAt(ledger, 'assets:cash').id, amount: '-12.00', currency: 'CAD' },
    ])
    expect(listTransactions(ledger.db)[0]?.to).toBe('food')
  })

  test('undo puts it back where it was; redo moves it again', () => {
    const { ledger, ctx } = setup()
    const { id } = ok(
      writeSpend(ctx, { amount: '12', description: 'Lunch', to: { category: 'food' } }),
    )
    ok(editSpend(ctx, { id, amount: '12', description: 'Lunch', to: { category: 'fun' } }))

    ok(undoLast(ctx))
    expect(listTransactions(ledger.db)[0]?.to).toBe('food')
    ok(redoLast(ctx))
    expect(listTransactions(ledger.db)[0]?.to).toBe('fun')
  })

  test('the same category, by another case, writes nothing', () => {
    const { ctx } = setup()
    const { id } = ok(
      writeSpend(ctx, { amount: '12', description: 'Lunch', to: { category: 'food' } }),
    )
    const step = ctx.history.nextUndo()

    ok(editSpend(ctx, { id, amount: '12', description: 'Lunch', to: { category: 'Food' } }))

    expect(ctx.history.nextUndo()).toBe(step)
  })

  test('left out, it stays as it was', () => {
    const { ledger, ctx } = setup()
    const { id } = ok(
      writeSpend(ctx, { amount: '12', description: 'Lunch', to: { category: 'food' } }),
    )

    ok(editSpend(ctx, { id, amount: '13', description: 'Lunch' }))

    expect(listTransactions(ledger.db)[0]).toMatchObject({
      to: 'food',
      simple: { amount: '13.00' },
    })
  })

  test('a starting balance has no category to change: its accounts stay', () => {
    const { ledger, ctx } = setup()
    const { id: bank } = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '100' }),
    )
    const [start] = listTransactions(ledger.db)
    expect(start?.to).toBeNull()

    ok(
      editSpend(ctx, {
        id: start?.id ?? '',
        amount: '120',
        description: 'x',
        to: { category: 'food' },
      }),
    )

    expect(spendOf(ledger, start?.id ?? '').postings[0]).toEqual({
      accountId: bank,
      amount: '120.00',
      currency: 'CAD',
    })
    expect(count(ledger, "accounts WHERE path = 'expenses:food'")).toBe(0)
  })
})

describe('moving money between my accounts', () => {
  /** A bank account and the wallet, each holding any currency. */
  function twoAccounts() {
    const set = setup()
    const chequing = ok(addAccount(set.ctx, { name: 'chequing', kind: 'bank', currency: null }))
    ok(writeSpend(set.ctx, { amount: '4.50', description: 'Coffee', from: chequing.id }))
    const wallet = ok(addAccount(set.ctx, { name: 'wallet', kind: 'cash', currency: null }))
    return { ...set, chequing: chequing.id, wallet: wallet.id }
  }

  test('100 from chequing to the wallet: one goes down, the other up, and no category', () => {
    const { ledger, ctx, chequing, wallet } = twoAccounts()
    const categories = count(ledger, "accounts WHERE kind = 'category'")

    const { id } = ok(
      writeSpend(ctx, {
        amount: '100',
        description: 'Cash out',
        from: chequing,
        to: { account: wallet },
      }),
    )

    expect(spendOf(ledger, id).postings).toEqual([
      { accountId: wallet, amount: '100.00', currency: 'CAD' },
      { accountId: chequing, amount: '-100.00', currency: 'CAD' },
    ])
    expect(count(ledger, "accounts WHERE kind = 'category'")).toBe(categories)
    expect(listTransactions(ledger.db)[0]).toMatchObject({ from: 'chequing', to: 'wallet' })
    expect(ctx.history.nextUndo()?.name).toEqual({ kind: 'write', description: 'Cash out' })
  })

  test('paying off a card: what I owe on it goes down', () => {
    const { ledger, ctx, chequing } = twoAccounts()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: null, start: '300' }))

    const { id } = ok(
      writeSpend(ctx, {
        amount: '300',
        description: 'Pay visa',
        from: chequing,
        to: { account: visa.id },
      }),
    )

    expect(spendOf(ledger, id).postings[0]).toEqual({
      accountId: visa.id,
      amount: '300.00',
      currency: 'CAD',
    })
  })

  test('into an account kept to USD, from one that holds any, it moves USD', () => {
    const { ledger, ctx, chequing } = twoAccounts()
    const usd = ok(addAccount(ctx, { name: 'usd', kind: 'bank', currency: 'USD' }))

    const { id } = ok(
      writeSpend(ctx, { amount: '20', description: 'x', from: chequing, to: { account: usd.id } }),
    )

    expect(spendOf(ledger, id).postings.map((p) => p.currency)).toEqual(['USD', 'USD'])
  })

  test('between two kept to different currencies, the ledger refuses it', () => {
    const { ledger, ctx } = setup()
    const cad = ok(addAccount(ctx, { name: 'cad', kind: 'bank', currency: 'CAD' }))
    const eur = ok(addAccount(ctx, { name: 'eur', kind: 'bank', currency: 'EUR' }))

    expect(
      writeSpend(ctx, { amount: '20', description: 'x', from: cad.id, to: { account: eur.id } }),
    ).toEqual({
      ok: false,
      failure: {
        code: 'ACCOUNT_CURRENCY_LOCKED',
        details: { accountId: eur.id, currency: 'CAD', locked: 'EUR' },
      },
    })
    expect(listTransactions(ledger.db)).toEqual([])
  })

  test('to the account it comes from: refused, and nothing remembered', () => {
    const { ledger, ctx, chequing, wallet } = twoAccounts()
    ctx.machine.usedFrom(wallet)
    const step = ctx.history.nextUndo()

    expect(
      writeSpend(ctx, { amount: '1', description: 'x', from: chequing, to: { account: chequing } }),
    ).toEqual({
      ok: false,
      failure: { code: 'TRANSFER_TO_ITSELF', details: { accountId: chequing } },
    })
    // From left alone is the account used last, and that's the same check.
    expect(writeSpend(ctx, { amount: '1', description: 'x', to: { account: wallet } })).toEqual({
      ok: false,
      failure: { code: 'TRANSFER_TO_ITSELF', details: { accountId: wallet } },
    })
    expect(listTransactions(ledger.db)).toHaveLength(1)
    expect(ctx.machine.lastFrom()).toBe(wallet)
    expect(ctx.history.nextUndo()).toBe(step)
  })

  test.each([
    ['a category', (ledger: Ledger) => accountAt(ledger, 'expenses:unsorted').id],
    ['an account the file does not hold', () => '7d1c2f3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'],
  ])('%s is not an account to move money to', (_, idIn) => {
    const { ledger, ctx, chequing } = twoAccounts()
    const id = idIn(ledger)

    expect(
      writeSpend(ctx, { amount: '1', description: 'x', from: chequing, to: { account: id } }),
    ).toEqual({ ok: false, failure: { code: 'ACCOUNT_NOT_FOUND', details: { accountId: id } } })
  })

  test('nor is an account taken back', () => {
    const { ctx, chequing } = twoAccounts()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: null }))
    ok(undoLast(ctx))

    expect(
      writeSpend(ctx, { amount: '1', description: 'x', from: chequing, to: { account: visa.id } }),
    ).toEqual({ ok: false, failure: { code: 'ACCOUNT_DELETED', details: { accountId: visa.id } } })
  })

  test('a spend changed into a transfer, and back into a spend; undo walks it back', () => {
    const { ledger, ctx, chequing, wallet } = twoAccounts()
    const [coffee] = listTransactions(ledger.db)
    const id = coffee?.id ?? ''

    ok(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', to: { account: wallet } }))
    expect(spendOf(ledger, id).postings.map((p) => p.accountId)).toEqual([wallet, chequing])
    expect(listTransactions(ledger.db)[0]?.to).toBe('wallet')

    ok(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', to: { category: 'food' } }))
    expect(listTransactions(ledger.db)[0]?.to).toBe('food')

    ok(undoLast(ctx))
    expect(listTransactions(ledger.db)[0]?.to).toBe('wallet')
    ok(undoLast(ctx))
    expect(listTransactions(ledger.db)[0]?.to).toBe('unsorted')
  })

  test('changed to go to the account it comes from: refused, and it stays', () => {
    const { ledger, ctx, chequing } = twoAccounts()
    const id = listTransactions(ledger.db)[0]?.id ?? ''

    expect(
      editSpend(ctx, { id, amount: '4.50', description: 'Coffee', to: { account: chequing } }),
    ).toEqual({
      ok: false,
      failure: { code: 'TRANSFER_TO_ITSELF', details: { accountId: chequing } },
    })
    expect(listTransactions(ledger.db)[0]?.to).toBe('unsorted')
  })

  test('a starting balance still can’t be sent elsewhere', () => {
    const { ledger, ctx, wallet } = twoAccounts()
    ok(addAccount(ctx, { name: 'savings', kind: 'bank', currency: null, start: '50' }))
    const start = listTransactions(ledger.db).find((t) => t.description === 'Starting balance')
    const before = spendOf(ledger, start?.id ?? '').postings

    ok(
      editSpend(ctx, {
        id: start?.id ?? '',
        amount: '50',
        description: 'Starting balance',
        to: { account: wallet },
      }),
    )

    expect(spendOf(ledger, start?.id ?? '').postings).toEqual(before)
  })
})

describe('listCategories', () => {
  test('the ones in use, most used first, then by name; never unsorted', () => {
    const { ledger, ctx } = setup()
    for (const category of ['fun', 'Food', 'food', 'travel', '', 'transport', 'transport']) {
      ok(writeSpend(ctx, { amount: '1', description: 'x', to: { category } }))
    }

    expect(listCategories(ledger.db).map(({ name, uses }) => [name, uses])).toEqual([
      ['Food', 2],
      ['transport', 2],
      ['fun', 1],
      ['travel', 1],
    ])
  })

  test('a removed spend no longer counts', () => {
    const { ledger, ctx } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '1', description: 'x', to: { category: 'food' } }))

    ok(removeSpend(ctx, { id }))

    expect(listCategories(ledger.db)).toEqual([])
  })
})

describe('money coming in', () => {
  /** Chequing, kept to CAD, and the ids of what's written into it. */
  function withChequing() {
    const env = setup()
    const chequing = ok(addAccount(env.ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' })).id
    return { ...env, chequing }
  }

  test('from an income source into chequing: chequing gains it, and the source is income', () => {
    const { ledger, ctx, chequing } = withChequing()

    const { id } = ok(
      writeSpend(ctx, {
        amount: '2000',
        description: 'Pay',
        from: { income: 'salary' },
        to: { account: chequing },
      }),
    )

    const salary = accountAt(ledger, 'income:salary')
    expect(salary).toMatchObject({ kind: 'income', currency: null, origin: { source: 'manual' } })
    expect(spendOf(ledger, id).postings).toEqual([
      { accountId: chequing, amount: '2000.00', currency: 'CAD' },
      { accountId: salary.id, amount: '-2000.00', currency: 'CAD' },
    ])
    expect(listAccounts(ledger.db).find((a) => a.id === chequing)?.balance).toEqual([
      { amount: '2000.00', currency: 'CAD' },
    ])
  })

  test('the source named again, whatever its case, is the same one', () => {
    const { ledger, ctx, chequing } = withChequing()
    const pay = (income: string) =>
      ok(
        writeSpend(ctx, {
          amount: '1',
          description: '',
          from: { income },
          to: { account: chequing },
        }),
      )
    pay('salary')
    pay(' Salary ')

    expect(listIncome(ledger.db).map(({ name, uses }) => [name, uses])).toEqual([['salary', 2]])
  })

  test('income is never a category, nor offered as one; nor is a category income', () => {
    const { ledger, ctx, chequing } = withChequing()
    ok(writeSpend(ctx, { amount: '1', description: '', to: { category: 'food' } }))
    ok(
      writeSpend(ctx, {
        amount: '1',
        description: '',
        from: { income: 'salary' },
        to: { account: chequing },
      }),
    )

    expect(listCategories(ledger.db).map((c) => c.name)).toEqual(['food'])
    expect(listIncome(ledger.db).map((c) => c.name)).toEqual(['salary'])
  })

  test.each([
    ['a category', { category: 'food' }],
    ['nothing, which is unsorted', { category: '' }],
  ])('into %s: refused, and nothing is written', (_, to) => {
    const { ledger, ctx } = withChequing()
    const before = count(ledger, 'accounts')

    const refused = writeSpend(ctx, { amount: '5', description: '', from: { income: 'gift' }, to })

    expect(refused).toMatchObject({ ok: false, failure: { code: 'INCOME_NOT_TO_ACCOUNT' } })
    expect(count(ledger, 'transactions')).toBe(0)
    expect(count(ledger, 'accounts')).toBe(before)
  })

  test('an income source is never the account used last', () => {
    const { ctx, chequing } = withChequing()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' })).id
    ok(writeSpend(ctx, { amount: '1', description: '', from: visa }))
    ok(
      writeSpend(ctx, {
        amount: '1',
        description: '',
        from: { income: 'salary' },
        to: { account: chequing },
      }),
    )

    expect(assumedFrom(ctx)).toEqual({ id: visa })
  })

  test('listed from the source to the account, and the account can be changed', () => {
    const { ledger, ctx, chequing } = withChequing()
    const savings = ok(addAccount(ctx, { name: 'savings', kind: 'bank', currency: 'CAD' })).id
    const { id } = ok(
      writeSpend(ctx, {
        amount: '20',
        description: 'Gift',
        from: { income: 'gifts' },
        to: { account: chequing },
      }),
    )
    expect(listTransactions(ledger.db)[0]).toMatchObject({ from: 'gifts', to: 'chequing' })

    ok(editSpend(ctx, { id, amount: '20', description: 'Gift', to: { account: savings } }))

    expect(listTransactions(ledger.db)[0]).toMatchObject({ from: 'gifts', to: 'savings' })
  })

  test('an edit sending it to a category is refused, and changes nothing', () => {
    const { ledger, ctx, chequing } = withChequing()
    const { id } = ok(
      writeSpend(ctx, {
        amount: '20',
        description: 'Gift',
        from: { income: 'gifts' },
        to: { account: chequing },
      }),
    )

    const refused = editSpend(ctx, {
      id,
      amount: '25',
      description: 'Gift',
      to: { category: 'food' },
    })

    expect(refused).toMatchObject({ ok: false, failure: { code: 'INCOME_NOT_TO_ACCOUNT' } })
    expect(spendOf(ledger, id).postings[0]).toMatchObject({ accountId: chequing, amount: '20.00' })
  })

  test('an income source with a name no account can have is refused', () => {
    const { ctx, chequing } = withChequing()
    const refused = writeSpend(ctx, {
      amount: '1',
      description: '',
      from: { income: 'pay::day' },
      to: { account: chequing },
    })
    expect(refused).toMatchObject({ ok: false, failure: { code: 'PATH_INVALID' } })
  })
})

describe('an amount finer than its currency', () => {
  /** A yen account, picked for the spend. */
  function inYen() {
    const s = setup()
    const yen = ok(addAccount(s.ctx, { name: 'yen', kind: 'cash', currency: 'JPY' }))
    return { ...s, yen: yen.id }
  }

  test('a spend of ¥1,500.50 is refused, naming the amount and the currency', () => {
    const { ctx, yen } = inYen()
    expect(writeSpend(ctx, { amount: '1500.50', description: 'Ramen', from: yen })).toEqual({
      ok: false,
      failure: { code: 'AMOUNT_TOO_PRECISE', details: { amount: '1500.50', currency: 'JPY' } },
    })
  })

  test('¥1,500 is written, and kept to two places as every amount is', () => {
    const { ledger, ctx, yen } = inYen()
    const { id } = ok(writeSpend(ctx, { amount: '1,500', description: 'Ramen', from: yen }))
    expect(spendOf(ledger, id).postings.map((p) => p.amount)).toEqual(['1500.00', '-1500.00'])
  })

  test("an edit to a yen spend can't add cents", () => {
    const { ctx, yen } = inYen()
    const { id } = ok(writeSpend(ctx, { amount: '1500', description: 'Ramen', from: yen }))
    const edited = editSpend(ctx, { id, amount: '1500.5', description: 'Ramen' })
    expect(edited.ok || edited.failure.code).toBe('AMOUNT_TOO_PRECISE')
  })

  test('cents are fine in a currency that has them', () => {
    const { ctx } = setup()
    expect(writeSpend(ctx, { amount: '1500.50', description: 'Dinner' }).ok).toBe(true)
  })
})
