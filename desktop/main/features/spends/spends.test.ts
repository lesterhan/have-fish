import type { AccountKind } from '@have-fish/core/account-kind'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { describe, expect, test } from 'vitest'
import type { Changed } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'
import { type Context, contextFor, type Time } from '../../context'
import { loadClock } from '../../db/clock'
import type { Ledger } from '../../db/ledger'
import { applyLocal } from '../../ledger/apply'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from '../../ledger/fixtures'
import { getDocument } from '../../ledger/store'
import { redoLast, undoLast } from '../../undo/steps'
import { addAccount, listAccounts } from '../accounts/accounts'
import { listPaths } from '../paths/paths'
import { spendingIn } from '../reports/reports'
import { assumedFrom, editSpend, removeSpend, writeSpend } from './spends'
import { listTransactions } from './transactions'

// 03:00 on the 30th in UTC, still the evening of the 29th in Vancouver.
const LATE = Date.UTC(2026, 9, 30, 3)
const ZONE = 'America/Vancouver'

function setup(ledger = tempLedger()) {
  const announced: Changed[][] = []
  const clock: Time & { at: number } = { at: LATE, now: () => clock.at, timeZone: () => ZONE }
  const ctx = contextFor({ ledger, announce: (changed) => announced.push(changed), time: clock })
  return { ledger, ctx, announced, clock }
}

const count = (ledger: Ledger, table: string) =>
  ledger.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()

/** The live paths of one kind. */
const pathsOf = (ledger: Ledger, kind: AccountKind) =>
  listPaths(ledger.db)
    .filter((p) => p.kind === kind)
    .map((p) => p.path)

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

  test('a refund into the bank from a category takes a new amount, in its stored order', () => {
    const ledger = tempLedger()
    const bank = anAccount({ path: 'assets:chequing', kind: 'bank' })
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const refund = aSpend(food.id, bank.id, '5.00', {
      postings: [
        { accountId: bank.id, amount: '5.00', currency: 'CAD' },
        { accountId: food.id, amount: '-5.00', currency: 'CAD' },
      ],
    })
    ok(applyLocal(ledger, [bank, food, refund], NOW))
    const { ctx } = setup(ledger)

    ok(editSpend(ctx, { id: refund.id, amount: '6', description: 'Refund' }))

    expect(spendOf(ledger, refund.id).postings).toEqual([
      { accountId: bank.id, amount: '6.00', currency: 'CAD' },
      { accountId: food.id, amount: '-6.00', currency: 'CAD' },
    ])
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
  test('a currency typed goes on both legs with the new amount', () => {
    const { ledger, ctx, id, before } = written()

    ok(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'JPY' }))

    expect(spendOf(ledger, id)).toEqual({
      ...before.doc,
      postings: [
        { ...before.doc.postings[0], amount: '1500.00', currency: 'JPY' },
        { ...before.doc.postings[1], amount: '-1500.00', currency: 'JPY' },
      ],
    })
  })

  test('no currency sent keeps the one the spend is in', () => {
    const { ledger, ctx, id } = written()
    ok(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'JPY' }))

    ok(editSpend(ctx, { id, amount: '2000', description: 'Coffee' }))

    expect(
      spendOf(ledger, id).postings.map(({ amount, currency }) => ({ amount, currency })),
    ).toEqual([
      { amount: '2000.00', currency: 'JPY' },
      { amount: '-2000.00', currency: 'JPY' },
    ])
  })

  test('the currency alone is a change', () => {
    const { ledger, ctx, id } = written()
    ok(editSpend(ctx, { id, amount: '1500', description: 'Coffee' }))
    const cad = getDocument(ledger.db, 'transaction', id)

    ok(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'JPY' }))

    const after = getDocument(ledger.db, 'transaction', id)
    expect(after?.version).not.toEqual(cad?.version)
    expect(after?.doc.postings.map((p) => p.currency)).toEqual(['JPY', 'JPY'])
  })

  test('the same currency sent again writes nothing', () => {
    const { ledger, ctx, id } = written()
    ok(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'JPY' }))
    const yen = getDocument(ledger.db, 'transaction', id)
    const step = ctx.history.nextUndo()

    expect(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'JPY' })).toEqual({
      ok: true,
      value: { id },
    })

    expect(getDocument(ledger.db, 'transaction', id)?.version).toEqual(yen?.version)
    expect(ctx.history.nextUndo()).toBe(step)
  })

  test('an amount is checked in the currency it is going to', () => {
    const { ctx, id } = written()

    expect(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', currency: 'JPY' })).toEqual({
      ok: false,
      failure: { code: 'AMOUNT_TOO_PRECISE', details: { amount: '4.50', currency: 'JPY' } },
    })
  })

  test('a code the ledger does not know is refused, and the spend stays as it was', () => {
    const { ledger, ctx, id, before } = written()

    expect(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'YEN' })).toEqual({
      ok: false,
      failure: { code: 'UNSUPPORTED_CURRENCY', details: { currency: 'YEN' } },
    })
    expect(spendOf(ledger, id)).toEqual(before.doc)
  })

  test('an edit to a code that is no currency is said before a day that is no day', () => {
    const { ctx, id } = written()
    const input = { id, amount: '1500', description: 'Coffee', currency: 'YEN', date: 'soon' }

    expect(editSpend(ctx, input)).toEqual({
      ok: false,
      failure: { code: 'UNSUPPORTED_CURRENCY', details: { currency: 'YEN' } },
    })
  })

  test('a spend from an account kept to CAD cannot go to yen', () => {
    const { ledger, ctx } = setup()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', from: visa.id }))
    const before = spendOf(ledger, id)

    expect(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'JPY' })).toEqual({
      ok: false,
      failure: {
        code: 'ACCOUNT_CURRENCY_LOCKED',
        details: { accountId: visa.id, currency: 'JPY', locked: 'CAD' },
      },
    })
    expect(spendOf(ledger, id)).toEqual(before)
  })

  test('a currency changed is one undo step, and redo puts it back', () => {
    const { ledger, ctx, id } = written()
    ok(editSpend(ctx, { id, amount: '1500', description: 'Coffee', currency: 'JPY' }))
    const legs = () =>
      spendOf(ledger, id).postings.map(({ amount, currency }) => ({ amount, currency }))

    ok(undoLast(ctx))
    expect(legs()).toEqual([
      { amount: '4.50', currency: 'CAD' },
      { amount: '-4.50', currency: 'CAD' },
    ])

    ok(redoLast(ctx))
    expect(legs()).toEqual([
      { amount: '1500.00', currency: 'JPY' },
      { amount: '-1500.00', currency: 'JPY' },
    ])
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
        shape: 'spend',
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
        origin: {
          source: 'manual',
          at: LATE + 60_000,
          here: true,
          file: null,
          line: null,
        },
      },
      {
        id: coffee.id,
        date: '2026-10-29',
        description: 'Coffee',
        shape: 'spend',
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
        origin: { source: 'manual', at: LATE, here: true, file: null, line: null },
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

  test('a spend paid in another currency lists its own amount, and what paid for it', () => {
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
      shape: 'converted',
      amounts: [
        { amount: '10.00', currency: 'CAD' },
        { amount: '1100.00', currency: 'JPY' },
      ],
      simple: { amount: '1100.00', currency: 'JPY' },
      charged: { amount: '10.00', currency: 'CAD' },
      from: 'cash',
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
    expect(ctx.history.nextUndo()?.name).toEqual({ action: 'remove', description: 'Coffee' })
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
    expect(ctx.history.nextUndo()?.name.action).toBe('remove')
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

  test('undo takes the spend back and leaves the category, which nothing then uses', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '12', description: 'Lunch', to: { category: 'food' } }))

    ok(undoLast(ctx))

    expect(accountAt(ledger, 'expenses:food').deletedAt).toBeNull()
    expect(listPaths(ledger.db).find((p) => p.path === 'expenses:food')?.lastUsed).toBeNull()
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
    expect(ctx.history.nextUndo()?.name).toEqual({ action: 'write', description: 'Cash out' })
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

    expect(pathsOf(ledger, 'income')).toEqual(['income:salary'])
  })

  test('income is never a category, nor a category income', () => {
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

    expect(pathsOf(ledger, 'category')).toEqual(['expenses:food'])
    expect(pathsOf(ledger, 'income')).toEqual(['income:salary'])
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

describe('a spend in the currency typed', () => {
  test('is written in that currency on both legs', () => {
    const { ledger, ctx } = setup()

    const { id } = ok(writeSpend(ctx, { amount: '1500', currency: 'JPY', description: 'Ramen' }))

    const wallet = accountAt(ledger, 'assets:cash')
    const unsorted = accountAt(ledger, 'expenses:unsorted')
    expect(spendOf(ledger, id).postings).toEqual([
      { accountId: unsorted.id, amount: '1500.00', currency: 'JPY' },
      { accountId: wallet.id, amount: '-1500.00', currency: 'JPY' },
    ])
  })

  test('the wallet holds dollars and yen side by side', () => {
    const { ledger, ctx } = setup()

    ok(writeSpend(ctx, { amount: '12', description: 'Lunch' }))
    ok(writeSpend(ctx, { amount: '1500', currency: 'JPY', description: 'Ramen' }))

    const wallet = listAccounts(ledger.db).find((a) => a.name === 'cash')
    expect(wallet?.balance).toEqual([
      { amount: '-12.00', currency: 'CAD' },
      { amount: '-1500.00', currency: 'JPY' },
    ])
  })

  test('a code typed wins over the one an account would pay in', () => {
    const { ledger, ctx } = setup()
    const wise = ok(addAccount(ctx, { name: 'wise', kind: 'bank', currency: null }))

    const cad = ok(writeSpend(ctx, { amount: '35', description: 'Museum', from: wise.id }))
    const eur = ok(
      writeSpend(ctx, { amount: '35', currency: 'EUR', description: 'Museum', from: wise.id }),
    )

    expect(spendOf(ledger, cad.id).postings.map((p) => p.currency)).toEqual(['CAD', 'CAD'])
    expect(spendOf(ledger, eur.id).postings.map((p) => p.currency)).toEqual(['EUR', 'EUR'])
  })

  test('a code the ledger does not know is refused, and makes no account', () => {
    const { ledger, ctx } = setup()

    expect(writeSpend(ctx, { amount: '1500', currency: 'YEN', description: 'Ramen' })).toEqual({
      ok: false,
      failure: { code: 'UNSUPPORTED_CURRENCY', details: { currency: 'YEN' } },
    })
    expect(count(ledger, 'accounts')).toBe(0)
  })

  test('a code is taken as sent, never put in capitals', () => {
    const { ctx } = setup()

    expect(writeSpend(ctx, { amount: '1500', currency: 'jpy', description: 'Ramen' })).toEqual({
      ok: false,
      failure: { code: 'UNSUPPORTED_CURRENCY', details: { currency: 'jpy' } },
    })
  })

  test('an amount that is not one is said before the code', () => {
    const { ctx } = setup()

    expect(writeSpend(ctx, { amount: 'abc', currency: 'YEN', description: '' })).toEqual({
      ok: false,
      failure: { code: 'AMOUNT_INVALID', details: { amount: 'abc' } },
    })
  })

  test('a code that is no currency is said before a day that is no day', () => {
    const { ctx } = setup()

    expect(
      writeSpend(ctx, { amount: '1500', currency: 'YEN', description: 'Ramen', date: 'soon' }),
    ).toEqual({
      ok: false,
      failure: { code: 'UNSUPPORTED_CURRENCY', details: { currency: 'YEN' } },
    })
  })

  test('yen with cents are refused', () => {
    const { ctx } = setup()

    expect(writeSpend(ctx, { amount: '1500.50', currency: 'JPY', description: 'Ramen' })).toEqual({
      ok: false,
      failure: { code: 'AMOUNT_TOO_PRECISE', details: { amount: '1500.50', currency: 'JPY' } },
    })
  })
})

describe('a yen spend a card kept to CAD paid', () => {
  /** Dinner in Tokyo: ¥4,000, which the card was charged 36.20 for. */
  const DINNER = {
    amount: '4000',
    currency: 'JPY',
    charged: '36.20',
    description: 'Dinner',
    to: { category: 'food' },
  }

  /** A ledger with visa, a card kept to CAD. */
  function withVisa() {
    const setup_ = setup()
    const visa = ok(addAccount(setup_.ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    return { ...setup_, visa }
  }

  test('is written through the conversion account, balanced in each currency', () => {
    const { ledger, ctx, visa } = withVisa()

    const { id } = ok(writeSpend(ctx, { ...DINNER, from: visa.id }))

    const food = accountAt(ledger, 'expenses:food')
    const fx = accountAt(ledger, 'equity:conversion')
    expect(spendOf(ledger, id).postings).toEqual([
      { accountId: food.id, amount: '4000.00', currency: 'JPY' },
      { accountId: fx.id, amount: '-4000.00', currency: 'JPY' },
      { accountId: fx.id, amount: '36.20', currency: 'CAD' },
      { accountId: visa.id, amount: '-36.20', currency: 'CAD' },
    ])
  })

  test('makes the conversion account, as the app', () => {
    const { ledger, ctx, visa } = withVisa()

    ok(writeSpend(ctx, { ...DINNER, from: visa.id }))

    expect(accountAt(ledger, 'equity:conversion')).toMatchObject({
      kind: 'conversion',
      currency: null,
      origin: { source: 'system' },
    })
  })

  test('a second one goes through the same conversion account', () => {
    const { ledger, ctx, visa } = withVisa()

    const first = ok(writeSpend(ctx, { ...DINNER, from: visa.id }))
    const second = ok(writeSpend(ctx, { ...DINNER, description: 'Ramen', from: visa.id }))

    const fx = accountAt(ledger, 'equity:conversion')
    for (const { id } of [first, second]) {
      expect(spendOf(ledger, id).postings.filter((p) => p.accountId === fx.id)).toHaveLength(2)
    }
  })

  test('the card owes the dollars it was charged, and only those', () => {
    const { ledger, ctx, visa } = withVisa()

    ok(writeSpend(ctx, { ...DINNER, from: visa.id }))

    expect(listAccounts(ledger.db).find((a) => a.id === visa.id)?.balance).toEqual([
      { amount: '-36.20', currency: 'CAD' },
    ])
  })

  test('the card that paid is the one the next spend comes from', () => {
    const { ctx, visa } = withVisa()
    expect(ctx.machine.lastFrom()).not.toBe(visa.id)

    ok(writeSpend(ctx, { ...DINNER, from: visa.id }))

    expect(ctx.machine.lastFrom()).toBe(visa.id)
  })

  test('a charge that is not an amount is refused', () => {
    const { ledger, ctx, visa } = withVisa()

    expect(writeSpend(ctx, { ...DINNER, charged: 'abc', from: visa.id })).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: 'abc' } },
    })
    expect(listTransactions(ledger.db)).toEqual([])
  })

  test('a charge of nothing is refused', () => {
    const { ledger, ctx, visa } = withVisa()

    expect(writeSpend(ctx, { ...DINNER, charged: '0', from: visa.id })).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '0' } },
    })
    expect(listTransactions(ledger.db)).toEqual([])
  })

  test('a charge is checked in the card’s currency: a yen card has no cents', () => {
    const { ctx } = setup()
    const card = ok(addAccount(ctx, { name: 'jcb', kind: 'card', currency: 'JPY' }))
    const input = { amount: '20', currency: 'CAD', charged: '1500.50', description: 'Taxi' }

    expect(writeSpend(ctx, { ...input, from: card.id })).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '1500.50' } },
    })
  })

  test('a charge from the wallet, which holds any currency, is refused and nothing saved', () => {
    const { ledger, ctx } = setup()

    expect(writeSpend(ctx, DINNER)).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '36.20' } },
    })
    expect(listTransactions(ledger.db)).toEqual([])
  })

  test('a charge for a spend in the card’s own currency is refused', () => {
    const { ctx, visa } = withVisa()
    const input = { amount: '36.20', charged: '36.20', description: 'Dinner', from: visa.id }

    expect(writeSpend(ctx, input)).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '36.20' } },
    })
  })

  test('yen moved from the card to an account of mine is still refused as locked', () => {
    const { ctx, visa } = withVisa()
    const cash = ok(addAccount(ctx, { name: 'cash', kind: 'cash', currency: null }))
    const input = { amount: '4000', currency: 'JPY', description: 'Cash out' }

    expect(writeSpend(ctx, { ...input, from: visa.id, to: { account: cash.id } })).toEqual({
      ok: false,
      failure: {
        code: 'ACCOUNT_CURRENCY_LOCKED',
        details: { accountId: visa.id, currency: 'JPY', locked: 'CAD' },
      },
    })
  })

  test('an amount that is not one is said before the missing charge', () => {
    const { ctx, visa } = withVisa()
    const input = { amount: 'abc', currency: 'JPY', description: 'Dinner', from: visa.id }

    expect(writeSpend(ctx, input)).toEqual({
      ok: false,
      failure: { code: 'AMOUNT_INVALID', details: { amount: 'abc' } },
    })
  })

  test('undo takes the whole of it back', () => {
    const { ledger, ctx, visa } = withVisa()
    ok(writeSpend(ctx, { ...DINNER, from: visa.id }))
    expect(listTransactions(ledger.db)).toHaveLength(1)

    ok(undoLast(ctx))

    expect(listTransactions(ledger.db)).toEqual([])
  })

  test('lists as the yen it cost, with the dollars charged for it', () => {
    const { ledger, ctx, visa } = withVisa()

    ok(writeSpend(ctx, { ...DINNER, from: visa.id }))

    expect(listTransactions(ledger.db)[0]).toMatchObject({
      shape: 'converted',
      simple: { amount: '4000.00', currency: 'JPY' },
      charged: { amount: '36.20', currency: 'CAD' },
      from: 'visa',
      to: 'food',
      fromPath: 'liabilities:visa',
      toPath: 'expenses:food',
    })
  })

  test('a spend in the card’s own currency lists with no charge', () => {
    const { ledger, ctx, visa } = withVisa()

    ok(writeSpend(ctx, { amount: '36.20', description: 'Dinner', from: visa.id }))

    expect(listTransactions(ledger.db)[0]).not.toHaveProperty('charged')
  })

  describe('a charge left to wait', () => {
    /** ¥8,400 from visa to food, its charge left for the statement; its id. */
    function waitingLunch(ctx: Context, visa: string): string {
      const { charged: _, ...uncharged } = DINNER
      return ok(
        writeSpend(ctx, {
          ...uncharged,
          amount: '8400',
          description: 'Lunch',
          from: visa,
          to: { category: 'food' },
        }),
      ).id
    }

    test('a charge left empty waits: the yen at zero in CAD, through the conversion account', () => {
      const { ledger, ctx, visa } = withVisa()
      const { charged: _, ...uncharged } = DINNER

      const { id } = ok(writeSpend(ctx, { ...uncharged, amount: '8400', from: visa.id }))

      expect(postingLines(ledger, id)).toEqual([
        'food 8400.00 JPY',
        'conversion -8400.00 JPY',
        'conversion 0.00 CAD',
        'visa 0.00 CAD',
      ])
    })

    test.each(['', '   '])('a charge of %j waits, on the same four postings', (charged) => {
      const { ledger, ctx, visa } = withVisa()

      const { id } = ok(writeSpend(ctx, { ...DINNER, amount: '8400', charged, from: visa.id }))

      expect(postingLines(ledger, id)).toEqual([
        'food 8400.00 JPY',
        'conversion -8400.00 JPY',
        'conversion 0.00 CAD',
        'visa 0.00 CAD',
      ])
    })

    test('a waiting spend makes the conversion account in its batch, as the app', () => {
      const { ledger, ctx, visa } = withVisa()
      const { charged: _, ...uncharged } = DINNER

      ok(writeSpend(ctx, { ...uncharged, amount: '8400', from: visa.id }))

      expect(accountAt(ledger, 'equity:conversion')).toMatchObject({
        kind: 'conversion',
        currency: null,
        origin: { source: 'system' },
      })
    })

    test('a waiting spend remembers the card that paid, for the next line', () => {
      const { ctx, visa } = withVisa()

      waitingLunch(ctx, visa.id)

      expect(ctx.machine.lastFrom()).toBe(visa.id)
    })

    test('a waiting spend lists the yen it was, with its zero CAD charge', () => {
      const { ledger, ctx, visa } = withVisa()
      const id = waitingLunch(ctx, visa.id)

      const [row] = listTransactions(ledger.db)
      expect(row?.id).toBe(id)
      expect(row).toMatchObject({
        shape: 'awaiting',
        simple: { amount: '8400.00', currency: 'JPY' },
        charged: { amount: '0.00', currency: 'CAD' },
        from: 'visa',
        to: 'food',
      })
    })

    test('the charge fills the four postings, each in its place', () => {
      const { ledger, ctx, visa } = withVisa()
      const id = waitingLunch(ctx, visa.id)

      ok(editSpend(ctx, { id, amount: '8400', description: 'Lunch', charged: '76.30' }))

      expect(postingLines(ledger, id)).toEqual([
        'food 8400.00 JPY',
        'conversion -8400.00 JPY',
        'conversion 76.30 CAD',
        'visa -76.30 CAD',
      ])
    })

    test('a waiting spend saved as it was keeps its version and adds no step', () => {
      const { ledger, ctx, visa } = withVisa()
      const id = waitingLunch(ctx, visa.id)
      const before = getDocument(ledger.db, 'transaction', id)
      const step = ctx.history.nextUndo()

      expect(editSpend(ctx, { id, amount: '8400', description: 'Lunch' })).toEqual({
        ok: true,
        value: { id },
      })

      expect(getDocument(ledger.db, 'transaction', id)?.version).toEqual(before?.version)
      expect(ctx.history.nextUndo()).toBe(step)
    })

    test('a new yen amount keeps it waiting: the CAD pair stays at zero', () => {
      const { ledger, ctx, visa } = withVisa()
      const id = waitingLunch(ctx, visa.id)

      ok(editSpend(ctx, { id, amount: '9000', description: 'Lunch' }))

      expect(postingLines(ledger, id)).toEqual([
        'food 9000.00 JPY',
        'conversion -9000.00 JPY',
        'conversion 0.00 CAD',
        'visa 0.00 CAD',
      ])
    })

    test('an amount in the card’s own currency makes it a plain spend again', () => {
      const { ledger, ctx, visa } = withVisa()
      const id = waitingLunch(ctx, visa.id)

      ok(editSpend(ctx, { id, amount: '20', currency: 'CAD', description: 'Lunch' }))

      expect(postingLines(ledger, id)).toEqual(['food 20.00 CAD', 'visa -20.00 CAD'])
    })

    test('a waiting spend can’t be refiled onto an account of mine', () => {
      const { ctx, visa } = withVisa()
      const id = waitingLunch(ctx, visa.id)
      const cash = ok(addAccount(ctx, { name: 'cash', kind: 'cash', currency: null }))

      expect(
        editSpend(ctx, { id, amount: '8400', description: 'Lunch', to: { account: cash.id } }),
      ).toEqual({ ok: false, failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id } } })
    })

    test('undo takes the charge back to waiting', () => {
      const { ledger, ctx, visa } = withVisa()
      const id = waitingLunch(ctx, visa.id)
      ok(editSpend(ctx, { id, amount: '8400', description: 'Lunch', charged: '76.30' }))

      ok(undoLast(ctx))

      expect(postingLines(ledger, id)).toEqual([
        'food 8400.00 JPY',
        'conversion -8400.00 JPY',
        'conversion 0.00 CAD',
        'visa 0.00 CAD',
      ])
    })
  })

  /** The dinner, written from visa, and its document as it was just after. */
  function dinner() {
    const withCard = withVisa()
    const { id } = ok(writeSpend(withCard.ctx, { ...DINNER, from: withCard.visa.id }))
    const before = getDocument(withCard.ledger.db, 'transaction', id)
    if (before === null) throw new Error('not written')
    return { ...withCard, id, before }
  }

  /** A converted dinner as sync or an import puts it: from visa, kept to `currency`, in order. */
  type Leg = ['visa' | 'conversion' | 'food', string, string]
  function putDinner(currency: string | null, legs: Leg[]) {
    const ledger = tempLedger()
    const visa = anAccount({ path: 'liabilities:visa', kind: 'card', currency })
    const fx = anAccount({ path: 'equity:conversion', kind: 'conversion' })
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const ids = { visa: visa.id, conversion: fx.id, food: food.id }
    const spend = {
      ...aSpend(visa.id, food.id),
      description: 'Dinner',
      postings: legs.map(([name, amount, code]) => ({
        accountId: ids[name],
        amount,
        currency: code,
      })),
    }
    ok(applyLocal(ledger, [visa, fx, food, spend], NOW))
    return { ledger, ctx: setup(ledger).ctx, id: spend.id }
  }

  test('refiled, only its yen moves to the new category; the conversion and the card stay', () => {
    const { ledger, ctx, id, before } = dinner()

    ok(editSpend(ctx, { id, amount: '4000', description: 'Dinner', to: { category: 'drinks' } }))

    const drinks = accountAt(ledger, 'expenses:drinks')
    const [yen, ...rest] = before.doc.postings
    expect(spendOf(ledger, id).postings).toEqual([{ ...yen, accountId: drinks.id }, ...rest])
  })

  test('a new description and day change, and its postings stay as they were', () => {
    const { ledger, ctx, id, before } = dinner()
    const input = { id, amount: '4000', description: 'Dinner, Shinjuku', date: '2026-10-28' }

    ok(editSpend(ctx, input))

    const after = spendOf(ledger, id)
    expect([after.description, after.date]).toEqual(['Dinner, Shinjuku', '2026-10-28'])
    expect(after.postings).toEqual(before.doc.postings)
  })

  /** The dinner's postings, in order, as account, amount and currency. */
  function postingLines(ledger: Ledger, id: string) {
    const food = accountAt(ledger, 'expenses:food')
    const fx = accountAt(ledger, 'equity:conversion')
    const visa = accountAt(ledger, 'liabilities:visa')
    const names = new Map([food, fx, visa].map((a) => [a.id, a.path.split(':')[1]]))
    return spendOf(ledger, id).postings.map(
      (p) => `${names.get(p.accountId) ?? p.accountId} ${p.amount} ${p.currency}`,
    )
  }

  test('a new amount: the yen change, and the card still owes what it was charged', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '4500', description: 'Dinner' }))

    expect(postingLines(ledger, id)).toEqual([
      'food 4500.00 JPY',
      'conversion -4500.00 JPY',
      'conversion 36.20 CAD',
      'visa -36.20 CAD',
    ])
  })

  test('a new charge: the card owes it, and the yen stay', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '38.10' }))

    expect(postingLines(ledger, id)).toEqual([
      'food 4000.00 JPY',
      'conversion -4000.00 JPY',
      'conversion 38.10 CAD',
      'visa -38.10 CAD',
    ])
  })

  test('an amount in the card’s own currency: a plain spend from the card, the conversion gone', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '40', currency: 'CAD', description: 'Dinner' }))

    expect(postingLines(ledger, id)).toEqual(['food 40.00 CAD', 'visa -40.00 CAD'])
  })

  test('made plain, it lists as a spend with no charge', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '40', currency: 'CAD', description: 'Dinner' }))

    const [row] = listTransactions(ledger.db)
    expect(row?.shape).toBe('spend')
    expect(row).not.toHaveProperty('charged')
  })

  test('from a card kept to no currency, its leg says what it paid in: 40 CAD makes it plain', () => {
    const { ledger, ctx, id } = putDinner(null, [
      ['food', '4000.00', 'JPY'],
      ['conversion', '-4000.00', 'JPY'],
      ['conversion', '36.20', 'CAD'],
      ['visa', '-36.20', 'CAD'],
    ])

    ok(editSpend(ctx, { id, amount: '40', currency: 'CAD', description: 'Dinner' }))

    expect(postingLines(ledger, id)).toEqual(['food 40.00 CAD', 'visa -40.00 CAD'])
  })

  test('from a card kept to USD, 40 CAD is still converted from the 27.00 it paid', () => {
    const { ledger, ctx, id } = putDinner('USD', [
      ['food', '4000.00', 'JPY'],
      ['conversion', '-4000.00', 'JPY'],
      ['conversion', '27.00', 'USD'],
      ['visa', '-27.00', 'USD'],
    ])

    ok(editSpend(ctx, { id, amount: '40', currency: 'CAD', description: 'Dinner' }))

    expect(postingLines(ledger, id)).toEqual([
      'food 40.00 CAD',
      'conversion -40.00 CAD',
      'conversion 27.00 USD',
      'visa -27.00 USD',
    ])
  })

  test('an amount in a third currency: converted from the same charge', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '30', currency: 'EUR', description: 'Dinner' }))

    expect(postingLines(ledger, id)).toEqual([
      'food 30.00 EUR',
      'conversion -30.00 EUR',
      'conversion 36.20 CAD',
      'visa -36.20 CAD',
    ])
  })

  test('a new amount and a new charge in one edit: both change', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '4500', description: 'Dinner', charged: '38.10' }))

    expect(postingLines(ledger, id)).toEqual([
      'food 4500.00 JPY',
      'conversion -4500.00 JPY',
      'conversion 38.10 CAD',
      'visa -38.10 CAD',
    ])
  })

  test('a new amount and a new category in one edit: the yen move there', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '4500', description: 'Dinner', to: { category: 'drinks' } }))

    const drinks = accountAt(ledger, 'expenses:drinks')
    expect(spendOf(ledger, id).postings[0]).toEqual({
      accountId: drinks.id,
      amount: '4500.00',
      currency: 'JPY',
    })
  })

  test('made plain and refiled in one edit: the dollars go to the new category', () => {
    const { ledger, ctx, id } = dinner()
    const input = { id, amount: '40', currency: 'CAD', description: 'Dinner' }

    ok(editSpend(ctx, { ...input, to: { category: 'drinks' } }))

    const drinks = accountAt(ledger, 'expenses:drinks')
    const visa = accountAt(ledger, 'liabilities:visa')
    expect(spendOf(ledger, id).postings).toEqual([
      { accountId: drinks.id, amount: '40.00', currency: 'CAD' },
      { accountId: visa.id, amount: '-40.00', currency: 'CAD' },
    ])
  })

  test('postings written card first keep their places through a new amount', () => {
    const { ledger, ctx, id } = putDinner('CAD', [
      ['visa', '-36.20', 'CAD'],
      ['conversion', '36.20', 'CAD'],
      ['conversion', '-4000.00', 'JPY'],
      ['food', '4000.00', 'JPY'],
    ])

    ok(editSpend(ctx, { id, amount: '4500', description: 'Dinner' }))

    expect(postingLines(ledger, id)).toEqual([
      'visa -36.20 CAD',
      'conversion 36.20 CAD',
      'conversion -4500.00 JPY',
      'food 4500.00 JPY',
    ])
  })

  test.each([
    ['a new amount', { amount: '4500' }],
    ['a new charge', { amount: '4000', charged: '38.10' }],
    ['made plain', { amount: '40', currency: 'CAD' }],
    ['a third currency', { amount: '30', currency: 'EUR' }],
  ])('%s, then undo: its postings are as they were', (_, change) => {
    const { ledger, ctx, id, before } = dinner()
    ok(editSpend(ctx, { id, description: 'Dinner', ...change }))
    expect(spendOf(ledger, id).postings).not.toEqual(before.doc.postings)

    ok(undoLast(ctx))

    expect(spendOf(ledger, id).postings).toEqual(before.doc.postings)
  })

  test('made plain, undone, then redone: two postings again', () => {
    const { ledger, ctx, id } = dinner()
    ok(editSpend(ctx, { id, amount: '40', currency: 'CAD', description: 'Dinner' }))
    ok(undoLast(ctx))
    expect(postingLines(ledger, id)).toHaveLength(4)

    ok(redoLast(ctx))

    expect(postingLines(ledger, id)).toEqual(['food 40.00 CAD', 'visa -40.00 CAD'])
  })

  test('a new charge that is not an amount is refused', () => {
    const { ctx, id } = dinner()

    expect(editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: 'abc' })).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: 'abc' } },
    })
  })

  test('a new charge left empty is refused', () => {
    const { ctx, id } = dinner()

    expect(editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '' })).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '' } },
    })
  })

  test('a new charge of nothing is refused', () => {
    const { ctx, id } = dinner()

    expect(editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '0' })).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '0' } },
    })
  })

  test('a new charge below nothing is refused', () => {
    const { ctx, id } = dinner()

    expect(
      editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '-38.10' }),
    ).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '-38.10' } },
    })
  })

  test('a new charge past the cent is rounded, as a typed amount is', () => {
    const { ledger, ctx, id } = dinner()

    ok(editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '36.205' }))

    expect(postingLines(ledger, id)).toEqual([
      'food 4000.00 JPY',
      'conversion -4000.00 JPY',
      'conversion 36.21 CAD',
      'visa -36.21 CAD',
    ])
  })

  test('a new charge with its code typed after it is refused', () => {
    const { ctx, id } = dinner()

    expect(
      editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '38.10 cad' }),
    ).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '38.10 cad' } },
    })
  })

  test('a refused charge leaves its document and version as they were', () => {
    const { ledger, ctx, id, before } = dinner()

    expect(editSpend(ctx, { id, amount: '4500', description: 'Dinner', charged: 'abc' }).ok).toBe(
      false,
    )

    expect(getDocument(ledger.db, 'transaction', id)).toEqual(before)
  })

  test('a charge on a spend that converts nothing is refused', () => {
    const { ctx, visa } = withVisa()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', from: visa.id }))

    expect(editSpend(ctx, { id, amount: '4.50', description: 'Coffee', charged: '5' })).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '5' } },
    })
  })

  test('a charge with an amount that makes it plain is refused', () => {
    const { ctx, id } = dinner()
    const input = { id, amount: '40', currency: 'CAD', description: 'Dinner', charged: '38.10' }

    expect(editSpend(ctx, input)).toEqual({
      ok: false,
      failure: { code: 'CHARGED_INVALID', details: { charged: '38.10' } },
    })
  })

  test('an amount that is not one is said before a charge that is not one', () => {
    const { ctx, id } = dinner()

    expect(editSpend(ctx, { id, amount: 'abc', description: 'Dinner', charged: 'abc' })).toEqual({
      ok: false,
      failure: { code: 'AMOUNT_INVALID', details: { amount: 'abc' } },
    })
  })

  test('a charge typed as it was saved writes no version', () => {
    const { ledger, ctx, id, before } = dinner()

    expect(editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '36.2' })).toEqual({
      ok: true,
      value: { id },
    })

    expect(getDocument(ledger.db, 'transaction', id)?.version).toEqual(before.version)
  })

  test('a charge typed as it was saved adds no undo step', () => {
    const { ctx, id } = dinner()
    const step = ctx.history.nextUndo()

    ok(editSpend(ctx, { id, amount: '4000', description: 'Dinner', charged: '36.2' }))

    expect(ctx.history.nextUndo()).toBe(step)
  })

  test('saved as it was, it writes nothing and adds no undo step', () => {
    const { ledger, ctx, id, before } = dinner()
    const step = ctx.history.nextUndo()

    expect(editSpend(ctx, { id, amount: '4000', description: 'Dinner' })).toEqual({
      ok: true,
      value: { id },
    })

    expect(getDocument(ledger.db, 'transaction', id)?.version).toEqual(before.version)
    expect(ctx.history.nextUndo()).toBe(step)
  })

  test('refiled onto an account of mine, it is refused and stays as it was', () => {
    const { ledger, ctx, id, before } = dinner()
    const cash = ok(addAccount(ctx, { name: 'cash', kind: 'cash', currency: null }))
    const input = { id, amount: '4000', description: 'Dinner', to: { account: cash.id } }

    expect(editSpend(ctx, input)).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id } },
    })
    expect(spendOf(ledger, id)).toEqual(before.doc)
  })
})

describe('money exchanged between my accounts', () => {
  /** wise:cad kept to CAD and wise:eur kept to EUR, as at Wise. */
  function withWise() {
    const set = setup()
    const cad = ok(addAccount(set.ctx, { name: 'wise:cad', kind: 'bank', currency: 'CAD' })).id
    const eur = ok(addAccount(set.ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR' })).id
    return { ...set, cad, eur }
  }

  /** wise, one account that holds any currency. */
  function withOneWise() {
    const set = setup()
    const wise = ok(addAccount(set.ctx, { name: 'wise', kind: 'bank', currency: null })).id
    return { ...set, wise }
  }

  /** 100 CAD changed into 80 EUR, from wise:cad to wise:eur. */
  const changed = (from: string, eur: string) => ({
    amount: '100',
    description: '',
    from,
    to: { account: eur },
    arrived: '80',
  })

  /** The four postings of 100 CAD from `from` arriving as 80 EUR in `to`. */
  function exchanged(ledger: Ledger, from: string, to: string) {
    const fx = accountAt(ledger, 'equity:conversion').id
    return [
      { accountId: to, amount: '80.00', currency: 'EUR' },
      { accountId: fx, amount: '-80.00', currency: 'EUR' },
      { accountId: fx, amount: '100.00', currency: 'CAD' },
      { accountId: from, amount: '-100.00', currency: 'CAD' },
    ]
  }

  const arrivedRefused = (arrived: string) => ({
    ok: false,
    failure: { code: 'ARRIVED_INVALID', details: { arrived } },
  })

  test('100 from wise:cad arriving as 80 in wise:eur goes through the conversion account', () => {
    const { ledger, ctx, cad, eur } = withWise()

    const { id } = ok(writeSpend(ctx, changed(cad, eur)))

    expect(spendOf(ledger, id).postings).toEqual(exchanged(ledger, cad, eur))
  })

  test('100 cad from a wallet that holds any currency arriving as 80 in wise:eur', () => {
    const { ledger, ctx, eur } = withWise()
    const wallet = ok(addAccount(ctx, { name: 'wallet', kind: 'cash', currency: null })).id

    const { id } = ok(writeSpend(ctx, { ...changed(wallet, eur), currency: 'CAD' }))

    expect(spendOf(ledger, id).postings).toEqual(exchanged(ledger, wallet, eur))
  })

  test('100 cad arriving as 80 eur inside wise, which holds any currency', () => {
    const { ledger, ctx, wise } = withOneWise()

    const { id } = ok(
      writeSpend(ctx, { ...changed(wise, wise), currency: 'CAD', arrived: '80 eur' }),
    )

    expect(spendOf(ledger, id).postings).toEqual(exchanged(ledger, wise, wise))
  })

  test('inside wise with From left out, the account used last exchanges as if named', () => {
    const { ledger, ctx, wise } = withOneWise()
    ctx.machine.usedFrom(wise)
    const { from: _, ...unnamed } = changed(wise, wise)

    const { id } = ok(writeSpend(ctx, { ...unnamed, currency: 'CAD', arrived: '80 eur' }))

    expect(spendOf(ledger, id).postings).toEqual(exchanged(ledger, wise, wise))
  })

  test('with nothing used yet, the wallet main makes exchanges 100 cad into wise:eur', () => {
    const { ledger, ctx } = setup()
    const eur = ok(addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR' })).id
    const input = { amount: '100', currency: 'CAD', description: '', to: { account: eur } }

    const { id } = ok(writeSpend(ctx, { ...input, arrived: '80' }))

    expect(spendOf(ledger, id).postings).toEqual(
      exchanged(ledger, accountAt(ledger, 'assets:cash').id, eur),
    )
  })

  test('arrived typed with the code wise:eur is kept to is taken as without it', () => {
    const { ledger, ctx, cad, eur } = withWise()

    const { id } = ok(writeSpend(ctx, { ...changed(cad, eur), arrived: '80 eur' }))

    expect(spendOf(ledger, id).postings).toEqual(exchanged(ledger, cad, eur))
  })

  test('the first exchange makes the conversion account, and the second goes through it', () => {
    const { ledger, ctx, cad, eur } = withWise()
    const before = Number(count(ledger, 'accounts'))

    ok(writeSpend(ctx, changed(cad, eur)))
    expect(count(ledger, 'accounts')).toBe(before + 1)
    const { id } = ok(writeSpend(ctx, changed(cad, eur)))

    expect(count(ledger, 'accounts')).toBe(before + 1)
    expect(pathsOf(ledger, 'conversion')).toEqual(['equity:conversion'])
    expect(spendOf(ledger, id).postings).toEqual(exchanged(ledger, cad, eur))
  })

  test('with arrived left out, nothing is saved, the conversion account included', () => {
    const { ledger, ctx, cad, eur } = withWise()
    const { arrived: _, ...unarrived } = changed(cad, eur)
    const accounts = count(ledger, 'accounts')

    expect(writeSpend(ctx, unarrived)).toEqual(arrivedRefused(''))
    expect(count(ledger, 'accounts')).toBe(accounts)
  })

  test('arrived that is not an amount is refused', () => {
    const { ctx, cad, eur } = withWise()

    expect(writeSpend(ctx, { ...changed(cad, eur), arrived: '8x0' })).toEqual(arrivedRefused('8x0'))
  })

  test('nothing arrived is refused', () => {
    const { ctx, cad, eur } = withWise()

    expect(writeSpend(ctx, { ...changed(cad, eur), arrived: '0' })).toEqual(arrivedRefused('0'))
  })

  test('arrived in a currency other than wise:eur is kept to is refused', () => {
    const { ctx, cad, eur } = withWise()

    expect(writeSpend(ctx, { ...changed(cad, eur), arrived: '80 usd' })).toEqual(
      arrivedRefused('80 usd'),
    )
  })

  test('arrived in the currency it was sent in is refused', () => {
    const { ctx, wise } = withOneWise()
    const input = { ...changed(wise, wise), currency: 'CAD', arrived: '80 cad' }

    expect(writeSpend(ctx, input)).toEqual(arrivedRefused('80 cad'))
  })

  test('arrived in a code that is no currency is refused', () => {
    const { ctx, wise } = withOneWise()
    const input = { ...changed(wise, wise), currency: 'CAD', arrived: '80 xyz' }

    expect(writeSpend(ctx, input)).toEqual(arrivedRefused('80 xyz'))
  })

  test('arrived with no code inside an account that holds any currency is refused', () => {
    const { ctx, wise } = withOneWise()

    expect(writeSpend(ctx, { ...changed(wise, wise), currency: 'CAD' })).toEqual(
      arrivedRefused('80'),
    )
  })

  test('arrived with cents in a currency that has none is refused', () => {
    const { ctx, cad } = withWise()
    const jpy = ok(addAccount(ctx, { name: 'wise:jpy', kind: 'bank', currency: 'JPY' })).id

    expect(writeSpend(ctx, { ...changed(cad, jpy), arrived: '8000.5' })).toEqual(
      arrivedRefused('8000.5'),
    )
  })

  test('arrived into an account kept to the currency sent is refused: nothing exchanges', () => {
    const { ctx, cad } = withWise()
    const chequing = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' })).id

    expect(writeSpend(ctx, changed(cad, chequing))).toEqual(arrivedRefused('80'))
  })

  test('arrived on a spend to a category is refused', () => {
    const { ctx, cad } = withWise()
    const input = { ...changed(cad, cad), to: { category: 'food' } }

    expect(writeSpend(ctx, input)).toEqual(arrivedRefused('80'))
  })

  test('within wise with no code on the amount, arrived is refused and nothing saved', () => {
    const { ledger, ctx, wise } = withOneWise()
    const accounts = count(ledger, 'accounts')

    expect(writeSpend(ctx, { ...changed(wise, wise), arrived: '80 eur' })).toEqual(
      arrivedRefused('80 eur'),
    )
    expect(listTransactions(ledger.db)).toEqual([])
    expect(count(ledger, 'accounts')).toBe(accounts)
  })

  test('within wise:cad, kept to CAD, arrived is refused', () => {
    const { ctx, cad } = withWise()
    const input = { ...changed(cad, cad), currency: 'EUR' }

    expect(writeSpend(ctx, input)).toEqual(arrivedRefused('80'))
  })

  test('income in CAD into wise:eur is still refused as locked', () => {
    const { ctx, eur } = withWise()
    const input = {
      amount: '100',
      currency: 'CAD',
      description: '',
      from: { income: 'salary' },
      to: { account: eur },
    }

    expect(writeSpend(ctx, input)).toEqual({
      ok: false,
      failure: {
        code: 'ACCOUNT_CURRENCY_LOCKED',
        details: { accountId: eur, currency: 'CAD', locked: 'EUR' },
      },
    })
  })

  test('an undo takes the exchange back whole', () => {
    const { ledger, ctx, cad, eur } = withWise()
    ok(writeSpend(ctx, changed(cad, eur)))
    expect(listTransactions(ledger.db)).toHaveLength(1)

    ok(undoLast(ctx))

    expect(listTransactions(ledger.db)).toEqual([])
  })

  test('is listed as an exchange of what arrived, charged what was sent', () => {
    const { ledger, ctx, cad, eur } = withWise()

    ok(writeSpend(ctx, changed(cad, eur)))

    expect(listTransactions(ledger.db)[0]).toMatchObject({
      shape: 'exchange',
      simple: { amount: '80.00', currency: 'EUR' },
      charged: { amount: '100.00', currency: 'CAD' },
    })
  })

  test('is not spending: its week reports nothing spent and nothing in other currencies', () => {
    const { ledger, ctx, cad, eur } = withWise()

    ok(writeSpend(ctx, { ...changed(cad, eur), date: '2026-10-28' }))

    expect(ok(spendingIn(ledger.db, { start: '2026-10-26', end: '2026-11-01' }))).toMatchObject({
      spent: [],
    })
  })

  test('its description changes and its four postings stay as written', () => {
    const { ledger, ctx, cad, eur } = withWise()
    const { id } = ok(writeSpend(ctx, changed(cad, eur)))

    ok(editSpend(ctx, { id, amount: '80', description: 'Wise' }))

    expect(spendOf(ledger, id)).toMatchObject({
      description: 'Wise',
      postings: exchanged(ledger, cad, eur),
    })
  })

  test('its day changes and its four postings stay as written', () => {
    const { ledger, ctx, cad, eur } = withWise()
    const { id } = ok(writeSpend(ctx, { ...changed(cad, eur), date: '2026-10-28' }))

    ok(editSpend(ctx, { id, amount: '80', description: '', date: '2026-10-29' }))

    expect(spendOf(ledger, id)).toMatchObject({
      date: '2026-10-29',
      postings: exchanged(ledger, cad, eur),
    })
  })

  test('a new amount is refused as not simple', () => {
    const { ctx, cad, eur } = withWise()
    const { id } = ok(writeSpend(ctx, changed(cad, eur)))

    expect(editSpend(ctx, { id, amount: '90', description: '' })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id } },
    })
  })

  test('moved to another account of mine, it is refused as not simple', () => {
    const { ctx, cad, eur } = withWise()
    const chequing = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: null })).id
    const { id } = ok(writeSpend(ctx, changed(cad, eur)))

    expect(
      editSpend(ctx, { id, amount: '80', description: '', to: { account: chequing } }),
    ).toEqual({ ok: false, failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id } } })
  })

  test('in another currency, it is refused as not simple', () => {
    const { ctx, cad, eur } = withWise()
    const { id } = ok(writeSpend(ctx, changed(cad, eur)))

    expect(editSpend(ctx, { id, amount: '80', currency: 'CAD', description: '' })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id } },
    })
  })
})

describe('a starting balance that cost me', () => {
  /** A bank kept to EUR, started at 200 with a cost of 300: its start, as the app writes it. */
  function wiseEur() {
    const s = setup()
    ok(
      addAccount(s.ctx, {
        name: 'wise:eur',
        kind: 'bank',
        currency: 'EUR',
        start: '200',
        cost: '300',
      }),
    )
    const start = listTransactions(s.ledger.db)[0]
    return { ...s, id: start?.id ?? '', start }
  }

  test('is listed with its amount in euros and what it cost in dollars', () => {
    const { start } = wiseEur()

    expect(start).toMatchObject({
      shape: 'start',
      simple: { amount: '200.00', currency: 'EUR' },
      cost: { amount: '300.00', currency: 'CAD' },
    })
  })

  test('a start with no cost is listed with no cost', () => {
    const { ledger, ctx } = setup()
    ok(addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR', start: '200' }))

    expect(listTransactions(ledger.db)[0]).toMatchObject({ shape: 'start' })
    expect(listTransactions(ledger.db)[0]).not.toHaveProperty('cost')
  })

  test('is not spending: its week reports nothing spent and nothing in other currencies', () => {
    const { ledger } = wiseEur()

    expect(ok(spendingIn(ledger.db, { start: '2026-10-26', end: '2026-11-01' }))).toMatchObject({
      spent: [],
    })
  })

  test('its words change and its four postings stay as written', () => {
    const { ledger, ctx, id } = wiseEur()
    const postings = spendOf(ledger, id).postings

    ok(editSpend(ctx, { id, amount: '200', description: 'Wise' }))

    expect(spendOf(ledger, id)).toMatchObject({ description: 'Wise', postings })
  })

  test('its day changes and its four postings stay as written', () => {
    const { ledger, ctx, id } = wiseEur()
    const postings = spendOf(ledger, id).postings

    ok(editSpend(ctx, { id, amount: '200', description: '', date: '2026-10-28' }))

    expect(spendOf(ledger, id)).toMatchObject({ date: '2026-10-28', postings })
  })

  test('a new amount is refused, and its four postings stay as written', () => {
    const { ledger, ctx, id } = wiseEur()

    expect(editSpend(ctx, { id, amount: '250', description: '' })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id } },
    })
    expect(spendOf(ledger, id).postings).toHaveLength(4)
  })

  test('a new currency is refused, and its four postings stay as written', () => {
    const { ledger, ctx, id } = wiseEur()

    expect(editSpend(ctx, { id, amount: '200', currency: 'CAD', description: '' })).toEqual({
      ok: false,
      failure: { code: 'TRANSACTION_NOT_SIMPLE', details: { id } },
    })
    expect(spendOf(ledger, id).postings).toHaveLength(4)
  })

  test('a To is ignored, as for every start, and its four postings stay as written', () => {
    const { ledger, ctx, id } = wiseEur()
    const postings = spendOf(ledger, id).postings
    const { id: chequing } = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' }),
    )

    ok(editSpend(ctx, { id, amount: '200', description: '', to: { account: chequing } }))

    expect(spendOf(ledger, id).postings).toEqual(postings)
  })
})
