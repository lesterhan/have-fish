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
import { editSpend, listTransactions, removeSpend, writeSpend } from './spends'

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

    expect(announced).toEqual([
      [
        { type: 'account', id: accountAt(ledger, 'assets:cash').id },
        { type: 'account', id: accountAt(ledger, 'expenses:unsorted').id },
        { type: 'transaction', id },
      ],
    ])
  })
})

describe('editSpend', () => {
  /** A spend written down at LATE, and the ledger as it was just after. */
  function written() {
    const setup_ = setup()
    const { id } = ok(writeSpend(setup_.ctx, { amount: '4.50', description: 'Coffee' }))
    const before = getDocument(setup_.ledger.db, 'transaction', id)
    if (before === null) throw new Error('not written')
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
      },
      {
        id: coffee.id,
        date: '2026-10-29',
        description: 'Coffee',
        amounts: [{ amount: '4.50', currency: 'CAD' }],
        simple: { amount: '4.50', currency: 'CAD' },
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
    })
  })

  test('a transaction that moved nothing lists with no amounts', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    ok(applyLocal(ledger, [cash, food, aSpend(cash.id, food.id, '0.00')], NOW))

    expect(listTransactions(ledger.db)[0]).toMatchObject({ amounts: [], simple: null })
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
