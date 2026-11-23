import { calendarDateAt } from '@have-fish/core/calendar-date'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, test } from 'vitest'
import type { Changed } from '../../../shared/commands'
import { contextFor, type Time } from '../../context'
import type { Ledger } from '../../db/ledger'
import { applyLocal } from '../../ledger/apply'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from '../../ledger/fixtures'
import { getDocument, liveAccountAt } from '../../ledger/store'
import { undoItems } from '../../undo/menu'
import { redoLast, undoLast } from '../../undo/steps'
import { editSpend, removeSpend, writeSpend } from '../spends/spends'
import { listTransactions } from '../spends/transactions'
import { addAccount, balancesQuery, costStart, listAccounts, startAccount } from './accounts'

function setup() {
  const ledger = tempLedger()
  const announced: Changed[][] = []
  const clock: Time = { now: () => NOW, timeZone: () => 'UTC' }
  const ctx = contextFor({ ledger, announce: (changed) => announced.push(changed), time: clock })
  const stored = (id: string) => {
    const found = getDocument(ledger.db, 'account', id)
    if (found === null) throw new Error(`no account ${id}`)
    return found.doc
  }
  const names = () => listAccounts(ledger.db).map((a) => a.name)
  return { ledger, ctx, announced, stored, names }
}

const refusal = (outcome: { ok: boolean; failure?: unknown }) =>
  outcome.ok ? null : outcome.failure

/** How many rows a table, or a table with its own WHERE, holds. */
const count = (ledger: Ledger, table: string) =>
  ledger.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()

/** A transaction's postings, as the ledger stores them. */
function storedPostings(ledger: Ledger, id: string) {
  const stored = getDocument(ledger.db, 'transaction', id)
  if (stored === null || stored.doc.type !== 'transaction') throw new Error(`no transaction ${id}`)
  return stored.doc.postings
}

describe('addAccount', () => {
  test('a card goes under liabilities, as I named it, locked to the currency I picked', () => {
    const { ctx, stored, announced } = setup()

    const { id } = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))

    expect(stored(id)).toEqual({
      type: 'account',
      id,
      path: 'liabilities:visa',
      kind: 'card',
      currency: 'CAD',
      deletedAt: null,
      origin: { source: 'manual', createdAt: NOW, deviceId: ctx.ledger.meta.deviceId },
    })
    ctx.flush()
    expect(announced).toEqual([[{ type: 'account', id }]])
  })

  test('a loan is something I owe, like a card; a bank account is something I have', () => {
    const { ctx, stored } = setup()

    const loan = ok(addAccount(ctx, { name: 'car', kind: 'loan', currency: 'CAD' }))
    const bank = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' }))

    expect(stored(loan.id).path).toBe('liabilities:car')
    expect(stored(bank.id).path).toBe('assets:chequing')
  })

  test('with no currency it can hold any', () => {
    const { ctx, stored } = setup()

    const { id } = ok(addAccount(ctx, { name: 'wise', kind: 'bank', currency: null }))

    expect(stored(id).currency).toBeNull()
  })

  test('the name is trimmed, and a colon nests', () => {
    const { ctx, stored } = setup()

    const { id } = ok(addAccount(ctx, { name: '  wise:cad ', kind: 'bank', currency: 'CAD' }))

    expect(stored(id).path).toBe('assets:wise:cad')
  })

  test('a name that is empty, or only spaces, is refused', () => {
    const { ctx, names } = setup()

    for (const name of ['', '   ']) {
      expect(refusal(addAccount(ctx, { name, kind: 'bank', currency: 'CAD' }))).toEqual({
        code: 'ACCOUNT_NAME_EMPTY',
        details: undefined,
      })
    }
    expect(names()).toEqual([])
  })

  test('a name I already have is refused, whatever its case or kind', () => {
    const { ctx, names } = setup()
    ok(addAccount(ctx, { name: 'Visa', kind: 'card', currency: 'CAD' }))

    for (const kind of ['card', 'bank'] as const) {
      expect(refusal(addAccount(ctx, { name: 'visa ', kind, currency: 'CAD' }))).toEqual({
        code: 'ACCOUNT_NAME_TAKEN',
        details: { name: 'Visa' },
      })
    }
    expect(names()).toEqual(['Visa'])
  })

  test('the wallet a first spend made has its name, so a second cash is refused', () => {
    const { ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))

    expect(refusal(addAccount(ctx, { name: 'cash', kind: 'cash', currency: null }))).toEqual({
      code: 'ACCOUNT_NAME_TAKEN',
      details: { name: 'cash' },
    })
  })

  test('the name of an account taken back is free again', () => {
    const { ctx, names } = setup()
    ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(undoLast(ctx))

    ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'USD' }))

    expect(names()).toEqual(['visa'])
  })

  test('a name with an empty part is refused by the ledger’s own check', () => {
    const { ctx } = setup()

    expect(refusal(addAccount(ctx, { name: 'wise::cad', kind: 'bank', currency: 'CAD' }))).toEqual({
      code: 'PATH_INVALID',
      details: { path: 'assets:wise::cad' },
    })
  })

  test('a currency have-fish doesn’t know is refused', () => {
    const { ctx } = setup()

    expect(refusal(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'XYZ' }))).toEqual({
      code: 'UNSUPPORTED_CURRENCY',
      details: { currency: 'XYZ' },
    })
  })
})

describe('listAccounts', () => {
  test('lists what I have and owe by name, without regard to case; never categories', () => {
    const { ctx, ledger } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(addAccount(ctx, { name: 'Chequing', kind: 'bank', currency: 'CAD' }))
    ok(addAccount(ctx, { name: 'car', kind: 'loan', currency: null }))
    ok(applyLocal(ledger, [anAccount({ path: 'equity:opening', kind: 'opening' })], NOW))

    expect(listAccounts(ledger.db)).toEqual([
      { ...LISTED, name: 'car', kind: 'loan', currency: null },
      { ...LISTED, name: 'cash', kind: 'cash', currency: null, balance: [cad('-4.50')] },
      { ...LISTED, name: 'Chequing', kind: 'bank', currency: 'CAD' },
      { ...LISTED, name: 'visa', kind: 'card', currency: 'CAD' },
    ])
  })
})

const LISTED = { id: expect.any(String), start: null, balance: [] }
const cad = (amount: string) => ({ amount, currency: 'CAD' })

describe('an account’s balance', () => {
  /** A chequing account with 1,000 in it, and what the window says of each account by name. */
  function started() {
    const s = setup()
    const chequing = ok(
      addAccount(s.ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '1000' }),
    ).id
    const balances = () =>
      Object.fromEntries(listAccounts(s.ledger.db).map((a) => [a.name, a.balance]))
    return { ...s, chequing, balances }
  }

  test('nothing in it yet is no amounts', () => {
    const { ctx, ledger } = setup()
    ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' }))
    expect(listAccounts(ledger.db)[0]?.balance).toEqual([])
  })

  test('what came in minus what went out: spends, income and transfers', () => {
    const { ctx, ledger, chequing, balances } = started()
    ok(writeSpend(ctx, { amount: '50', description: 'Groceries', from: chequing }))
    const cash = ok(addAccount(ctx, { name: 'cash', kind: 'cash', currency: null })).id
    ok(writeSpend(ctx, { amount: '100', description: '', from: chequing, to: { account: cash } }))
    const salary = anAccount({ path: 'income:salary', kind: 'income' })
    ok(applyLocal(ledger, [salary, aSpend(salary.id, chequing, '2000.00')], NOW))

    expect(balances()).toEqual({ chequing: [cad('2850.00')], cash: [cad('100.00')] })
  })

  test('a card holds what I owe as the ledger does, below zero; paying it down raises it', () => {
    const { ctx, chequing, balances } = started()
    const visa = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' })).id
    ok(writeSpend(ctx, { amount: '30', description: 'Books', from: visa }))
    ok(writeSpend(ctx, { amount: '20', description: '', from: chequing, to: { account: visa } }))

    expect(balances().visa).toEqual([cad('-10.00')])
    expect(balances().chequing).toEqual([cad('980.00')])
  })

  test('a spend taken back no longer counts', () => {
    const { ctx, chequing, balances } = started()
    const { id } = ok(writeSpend(ctx, { amount: '50', description: '', from: chequing }))
    ok(removeSpend(ctx, { id }))

    expect(balances().chequing).toEqual([cad('1000.00')])
  })

  test('an account that holds any currency has an amount in each, by code; none that net to zero', () => {
    const { ledger } = setup()
    const wise = anAccount({ path: 'assets:wise', kind: 'bank' })
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const usd = (spend: ReturnType<typeof aSpend>) => ({
      ...spend,
      postings: spend.postings.map((p) => ({ ...p, currency: 'USD' })),
    })
    const eur = (spend: ReturnType<typeof aSpend>) => ({
      ...spend,
      postings: spend.postings.map((p) => ({ ...p, currency: 'EUR' })),
    })
    ok(
      applyLocal(
        ledger,
        [
          wise,
          food,
          aSpend(food.id, wise.id, '40.00'),
          usd(aSpend(food.id, wise.id, '7.25')),
          eur(aSpend(food.id, wise.id, '3.00')),
          eur(aSpend(wise.id, food.id, '3.00')),
        ],
        NOW,
      ),
    )

    expect(listAccounts(ledger.db)[0]?.balance).toEqual([
      cad('40.00'),
      { amount: '7.25', currency: 'USD' },
    ])
  })

  test('a removed starting balance takes its amount with it', () => {
    const { ledger, balances } = started()
    const start = listTransactions(ledger.db).find((t) => t.description === 'Starting balance')
    const stored = start && getDocument(ledger.db, 'transaction', start.id)
    if (!stored) throw new Error('no starting balance')
    ok(applyLocal(ledger, [tombstoneOf(stored.doc)], NOW))

    expect(balances().chequing).toEqual([])
  })
})

describe('the balances query', () => {
  test('reads one index and nothing else: no table, no join, no sort', () => {
    const { ledger } = setup()
    const { sql, params } = balancesQuery(drizzle(ledger.db)).toSQL()
    const plan = ledger.db
      .prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((row) => row.detail)
    expect(plan).toEqual(['SCAN postings USING COVERING INDEX postings_account_balance'])
  })
})

describe('undoing an account added', () => {
  test('takes it back as one step named for it, and redo puts it back', () => {
    const { ctx, names, stored } = setup()
    const { id } = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    const typing = { undo: false, redo: false }

    expect(undoItems(ctx.history, typing).undo.label).toBe('Undo add account visa')
    expect(ok(undoLast(ctx))).toEqual({ spends: [], accounts: [id] })
    expect(names()).toEqual([])
    expect(stored(id).deletedAt).toBe(NOW)

    expect(undoItems(ctx.history, typing).redo.label).toBe('Redo add account visa')
    expect(ok(redoLast(ctx))).toEqual({ spends: [], accounts: [id] })
    expect(names()).toEqual(['visa'])
    expect(stored(id).deletedAt).toBeNull()
  })

  test('a refused add leaves nothing to undo', () => {
    const { ctx } = setup()

    addAccount(ctx, { name: '', kind: 'card', currency: 'CAD' })

    expect(ctx.history.nextUndo()).toBeUndefined()
  })
})

describe('a starting balance, said when adding', () => {
  const TODAY = calendarDateAt(NOW, 'UTC')

  test('one transaction, dated today, from equity:opening into the account', () => {
    const { ctx, ledger } = setup()

    const { id } = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '1,234.56' }),
    )

    const opening = liveAccountAt(ledger.db, 'equity:opening')
    expect(opening).toBeDefined()
    const [listed] = listTransactions(ledger.db)
    expect(listed).toMatchObject({
      date: TODAY,
      description: 'Starting balance',
      amounts: [{ amount: '1234.56', currency: 'CAD' }],
      from: null,
    })
    const tx = getDocument(ledger.db, 'transaction', listed?.id ?? '')?.doc
    expect(tx?.type === 'transaction' && tx.postings).toEqual([
      { accountId: id, amount: '1234.56', currency: 'CAD' },
      { accountId: opening, amount: '-1234.56', currency: 'CAD' },
    ])
    expect(tx?.origin.source).toBe('manual')
    expect(listAccounts(ledger.db)[0]?.start).toEqual({
      amount: '1234.56',
      currency: 'CAD',
      date: TODAY,
    })
  })

  test('equity:opening is the app’s, made once, and never listed as mine', () => {
    const { ctx, ledger } = setup()
    ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '10' }))
    ok(addAccount(ctx, { name: 'savings', kind: 'bank', currency: 'CAD', start: '20' }))

    const opening = getDocument(
      ledger.db,
      'account',
      liveAccountAt(ledger.db, 'equity:opening') ?? '',
    )
    expect(opening?.doc).toMatchObject({
      kind: 'opening',
      currency: null,
      origin: { source: 'system' },
    })
    expect(
      ledger.db.prepare("SELECT count(*) FROM accounts WHERE kind = 'opening'").pluck().get(),
    ).toBe(1)
    expect(listAccounts(ledger.db).map((a) => a.name)).toEqual(['chequing', 'savings'])
  })

  test('the account, the opening account and the balance are one batch', () => {
    const { ctx, announced } = setup()

    ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '10' }))

    ctx.flush()
    expect(announced).toHaveLength(1)
    expect(announced[0]?.map((c) => c.type)).toEqual(['account', 'account', 'transaction'])
  })

  test.each(['card', 'loan'] as const)('what I owe on a %s goes on as owed', (kind) => {
    const { ctx, ledger } = setup()

    const { id } = ok(addAccount(ctx, { name: 'it', kind, currency: 'CAD', start: '500' }))

    const posting = ledger.db
      .prepare('SELECT amountCents FROM postings WHERE accountId = ?')
      .pluck()
      .get(id)
    expect(posting).toBe(-50000)
    expect(listAccounts(ledger.db)[0]?.start?.amount).toBe('500.00')
  })

  test('an overdrawn bank account starts below zero', () => {
    const { ctx, ledger } = setup()

    ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '-50' }))

    expect(listAccounts(ledger.db)[0]?.start?.amount).toBe('-50.00')
  })

  test('in the account’s currency; one that holds any starts in the home currency', () => {
    const { ctx, ledger } = setup()
    ok(addAccount(ctx, { name: 'usd', kind: 'bank', currency: 'USD', start: '5' }))
    ok(addAccount(ctx, { name: 'wise', kind: 'bank', currency: null, start: '5' }))

    expect(listAccounts(ledger.db).map((a) => a.start?.currency)).toEqual(['USD', 'CAD'])
  })

  test.each(['', '  ', '0', '0.00'])('%j adds the account with nothing in it', (start) => {
    const { ctx, ledger } = setup()

    ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start }))

    expect(listAccounts(ledger.db)[0]?.start).toBeNull()
    expect(listTransactions(ledger.db)).toEqual([])
    expect(liveAccountAt(ledger.db, 'equity:opening')).toBeUndefined()
  })

  test.each(['abc', '4,50', '1.2.3'])('%j is not an amount: nothing is added', (start) => {
    const { ctx, names } = setup()

    expect(
      refusal(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start })),
    ).toEqual({ code: 'AMOUNT_INVALID', details: { amount: start } })
    expect(names()).toEqual([])
    expect(ctx.history.nextUndo()).toBeUndefined()
  })

  test('undo takes back the account and its balance together; redo puts both back', () => {
    const { ctx, ledger } = setup()
    const { id } = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '10' }),
    )

    expect(ok(undoLast(ctx))).toEqual({ spends: [], accounts: [id] })
    expect(listAccounts(ledger.db)).toEqual([])
    expect(listTransactions(ledger.db)).toEqual([])

    expect(ok(redoLast(ctx))).toEqual({ spends: [], accounts: [id] })
    expect(listAccounts(ledger.db)[0]?.start?.amount).toBe('10.00')
    expect(listTransactions(ledger.db)).toHaveLength(1)
  })
})

describe('startAccount', () => {
  test('gives the wallet the app made a starting balance, as its own step', () => {
    const { ctx, ledger } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const wallet = liveAccountAt(ledger.db, 'assets:cash') ?? ''

    const { id } = ok(startAccount(ctx, { id: wallet, amount: '20' }))

    expect(id).not.toBeNull()
    expect(listAccounts(ledger.db)[0]?.start?.amount).toBe('20.00')
    const typing = { undo: false, redo: false }
    expect(undoItems(ctx.history, typing).undo.label).toBe('Undo starting balance of cash')
    expect(ok(undoLast(ctx))).toEqual({ spends: [], accounts: [wallet] })
    expect(listAccounts(ledger.db)[0]?.start).toBeNull()
    expect(undoItems(ctx.history, typing).redo.label).toBe('Redo starting balance of cash')
  })

  test('one that already has one is refused', () => {
    const { ctx } = setup()
    const { id } = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '10' }),
    )

    expect(refusal(startAccount(ctx, { id, amount: '20' }))).toEqual({
      code: 'ACCOUNT_ALREADY_STARTED',
      details: { accountId: id },
    })
  })

  test('nothing typed, or zero, writes nothing', () => {
    const { ctx, ledger } = setup()
    const { id } = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' }))
    const step = ctx.history.nextUndo()

    expect(ok(startAccount(ctx, { id, amount: '' }))).toEqual({ id: null })
    expect(ok(startAccount(ctx, { id, amount: '0' }))).toEqual({ id: null })
    expect(listTransactions(ledger.db)).toEqual([])
    expect(ctx.history.nextUndo()).toBe(step)
  })

  test('not an amount is refused', () => {
    const { ctx } = setup()
    const { id } = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' }))

    expect(refusal(startAccount(ctx, { id, amount: 'lots' }))).toEqual({
      code: 'AMOUNT_INVALID',
      details: { amount: 'lots' },
    })
  })

  test('a category, an account the file doesn’t hold, or one taken back, is refused', () => {
    const { ctx, ledger } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const unsorted = liveAccountAt(ledger.db, 'expenses:unsorted') ?? ''
    const missing = '7d1c2f3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
    const { id: gone } = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(undoLast(ctx))

    expect(refusal(startAccount(ctx, { id: unsorted, amount: '1' }))).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      details: { accountId: unsorted },
    })
    expect(refusal(startAccount(ctx, { id: missing, amount: '1' }))).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      details: { accountId: missing },
    })
    expect(refusal(startAccount(ctx, { id: gone, amount: '1' }))).toEqual({
      code: 'ACCOUNT_DELETED',
      details: { accountId: gone },
    })
  })

  test('a starting balance taken back is no start: one can be given again', () => {
    const { ctx, ledger } = setup()
    const { id } = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' }))
    ok(startAccount(ctx, { id, amount: '10' }))
    ok(undoLast(ctx))

    ok(startAccount(ctx, { id, amount: '30' }))

    expect(listAccounts(ledger.db)[0]?.start?.amount).toBe('30.00')
  })
})

describe('a starting balance finer than its currency', () => {
  test('is refused, and the account is not added', () => {
    const { ledger, ctx } = setup()
    const added = addAccount(ctx, { name: 'yen', kind: 'cash', currency: 'JPY', start: '100.5' })
    expect(added.ok || added.failure.code).toBe('AMOUNT_TOO_PRECISE')
    expect(listAccounts(ledger.db)).toEqual([])
  })
})

describe('a starting balance that cost me', () => {
  const TODAY = calendarDateAt(NOW, 'UTC')
  /** A bank kept to EUR with a start of 200 and a cost of 300, added: its id. */
  const wiseEur = (ctx: ReturnType<typeof setup>['ctx'], start = '200', cost = '300') =>
    ok(addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR', start, cost })).id
  /** A card kept to EUR, owed 200 which cost 300, added: its id. */
  const visaEur = (ctx: ReturnType<typeof setup>['ctx']) =>
    ok(
      addAccount(ctx, {
        name: 'visa:eur',
        kind: 'card',
        currency: 'EUR',
        start: '200',
        cost: '300',
      }),
    ).id
  /** Adding that bank with an invalid cost, and why it was refused. */
  const wiseEurRefusal = (ctx: ReturnType<typeof setup>['ctx'], cost: string, start = '200') =>
    refusal(addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR', start, cost }))

  test('a cost in another currency is a start through the conversion account', () => {
    const { ctx, ledger } = setup()

    const id = wiseEur(ctx)
    const conversion = liveAccountAt(ledger.db, 'equity:conversion') ?? ''
    const opening = liveAccountAt(ledger.db, 'equity:opening') ?? ''

    const [start] = listTransactions(ledger.db)
    expect(storedPostings(ledger, start?.id ?? '')).toEqual([
      { accountId: id, amount: '200.00', currency: 'EUR' },
      { accountId: conversion, amount: '-200.00', currency: 'EUR' },
      { accountId: conversion, amount: '300.00', currency: 'CAD' },
      { accountId: opening, amount: '-300.00', currency: 'CAD' },
    ])
  })

  test('the list says what the start cost, beside its amount', () => {
    const { ctx, ledger } = setup()

    wiseEur(ctx)

    expect(listAccounts(ledger.db)[0]?.start).toEqual({
      amount: '200.00',
      currency: 'EUR',
      date: TODAY,
      cost: { amount: '300.00', currency: 'CAD' },
    })
  })

  test('a debt’s cost goes the other way round, still balancing', () => {
    const { ctx, ledger } = setup()

    const id = visaEur(ctx)
    const conversion = liveAccountAt(ledger.db, 'equity:conversion') ?? ''
    const opening = liveAccountAt(ledger.db, 'equity:opening') ?? ''

    const [start] = listTransactions(ledger.db)
    expect(storedPostings(ledger, start?.id ?? '')).toEqual([
      { accountId: id, amount: '-200.00', currency: 'EUR' },
      { accountId: conversion, amount: '200.00', currency: 'EUR' },
      { accountId: conversion, amount: '-300.00', currency: 'CAD' },
      { accountId: opening, amount: '300.00', currency: 'CAD' },
    ])
  })

  test('the card’s start lists what it cost, in the home currency', () => {
    const { ctx, ledger } = setup()

    visaEur(ctx)

    expect(listAccounts(ledger.db)[0]?.start).toEqual({
      amount: '200.00',
      currency: 'EUR',
      date: TODAY,
      cost: { amount: '300.00', currency: 'CAD' },
    })
  })

  test('a start with no cost is the two postings it was, and lists none', () => {
    const { ctx, ledger } = setup()

    const { id } = ok(
      addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR', start: '200' }),
    )
    const opening = liveAccountAt(ledger.db, 'equity:opening') ?? ''

    const [start] = listTransactions(ledger.db)
    expect(storedPostings(ledger, start?.id ?? '')).toEqual([
      { accountId: id, amount: '200.00', currency: 'EUR' },
      { accountId: opening, amount: '-200.00', currency: 'EUR' },
    ])
    expect(listAccounts(ledger.db)[0]?.start).not.toHaveProperty('cost')
  })

  test('what the account holds is its own currency, never the cost', () => {
    const { ctx, ledger } = setup()

    wiseEur(ctx)

    expect(listAccounts(ledger.db)[0]?.balance).toEqual([{ amount: '200.00', currency: 'EUR' }])
  })

  test('the conversion account is made once, by the first start that needs it', () => {
    const { ctx, ledger, announced } = setup()

    wiseEur(ctx)
    ctx.flush()
    const conversion = liveAccountAt(ledger.db, 'equity:conversion') ?? ''
    ok(
      addAccount(ctx, {
        name: 'savings:eur',
        kind: 'bank',
        currency: 'EUR',
        start: '5',
        cost: '6',
      }),
    )
    ctx.flush()

    expect(count(ledger, "accounts WHERE path = 'equity:conversion'")).toBe(1)
    expect(announced[0]?.map((c) => c.id)).toContain(conversion)
    expect(announced[1]?.map((c) => c.id)).not.toContain(conversion)
  })

  test('undo takes the account and its start back, and leaves the conversion account', () => {
    const { ctx, ledger } = setup()
    wiseEur(ctx)

    ok(undoLast(ctx))

    expect(listAccounts(ledger.db)).toEqual([])
    expect(listTransactions(ledger.db)).toEqual([])
    expect(liveAccountAt(ledger.db, 'equity:conversion')).toBeDefined()
  })

  test('a cost that is not an amount is refused, and nothing is added', () => {
    const { ctx, ledger } = setup()

    expect(wiseEurRefusal(ctx, 'lots')).toEqual({ code: 'COST_INVALID', details: { cost: 'lots' } })
    expect(count(ledger, 'accounts')).toBe(0)
  })

  test('a cost of zero is refused', () => {
    const { ctx } = setup()

    expect(wiseEurRefusal(ctx, '0')).toEqual({ code: 'COST_INVALID', details: { cost: '0' } })
  })

  test('a cost below zero is refused', () => {
    const { ctx } = setup()

    expect(wiseEurRefusal(ctx, '-300')).toEqual({ code: 'COST_INVALID', details: { cost: '-300' } })
  })

  test('a cost past the cent rounds, as a typed amount does', () => {
    const { ctx, ledger } = setup()

    const id = wiseEur(ctx, '200', '300.005')
    const conversion = liveAccountAt(ledger.db, 'equity:conversion') ?? ''
    const opening = liveAccountAt(ledger.db, 'equity:opening') ?? ''

    const [start] = listTransactions(ledger.db)
    expect(storedPostings(ledger, start?.id ?? '')).toEqual([
      { accountId: id, amount: '200.00', currency: 'EUR' },
      { accountId: conversion, amount: '-200.00', currency: 'EUR' },
      { accountId: conversion, amount: '300.01', currency: 'CAD' },
      { accountId: opening, amount: '-300.01', currency: 'CAD' },
    ])
  })

  test('a cost on a start in the home currency is refused', () => {
    const { ctx, ledger, names } = setup()

    expect(
      refusal(
        addAccount(ctx, {
          name: 'chequing',
          kind: 'bank',
          currency: 'CAD',
          start: '200',
          cost: '300',
        }),
      ),
    ).toEqual({ code: 'START_NOT_COSTABLE', details: { accountId: expect.any(String) } })
    expect(names()).toEqual([])
    expect(count(ledger, 'accounts')).toBe(0)
  })

  test('a cost on a start in an account that holds any currency is refused: its start is in CAD', () => {
    const { ctx, names } = setup()

    expect(
      refusal(
        addAccount(ctx, {
          name: 'savings',
          kind: 'bank',
          currency: null,
          start: '200',
          cost: '300',
        }),
      ),
    ).toEqual({ code: 'START_NOT_COSTABLE', details: { accountId: expect.any(String) } })
    expect(names()).toEqual([])
  })

  test('a cost with nothing to cost is refused, and nothing is added', () => {
    const { ctx, names } = setup()

    expect(wiseEurRefusal(ctx, '300', '')).toEqual({
      code: 'START_NOT_COSTABLE',
      details: { accountId: expect.any(String) },
    })
    expect(names()).toEqual([])
  })
})

describe('a starting balance given later, with its cost', () => {
  test('is the same four postings, through the conversion account', () => {
    const { ctx, ledger } = setup()
    const { id } = ok(addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR' }))

    const { id: transaction } = ok(startAccount(ctx, { id, amount: '200', cost: '300' }))

    const conversion = liveAccountAt(ledger.db, 'equity:conversion') ?? ''
    const opening = liveAccountAt(ledger.db, 'equity:opening') ?? ''
    expect(storedPostings(ledger, transaction ?? '')).toEqual([
      { accountId: id, amount: '200.00', currency: 'EUR' },
      { accountId: conversion, amount: '-200.00', currency: 'EUR' },
      { accountId: conversion, amount: '300.00', currency: 'CAD' },
      { accountId: opening, amount: '-300.00', currency: 'CAD' },
    ])
  })
})

describe('a cost said after the start', () => {
  /** A bank kept to EUR with a start of 200 and nothing said of what it cost. */
  function wiseStarted() {
    const s = setup()
    const { id } = ok(
      addAccount(s.ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR', start: '200' }),
    )
    const start = listTransactions(s.ledger.db)[0]
    return { ...s, id, start }
  }

  test('says what the start cost, as a new version of the same start', () => {
    const { ctx, ledger, id, start } = wiseStarted()

    const { id: transaction } = ok(costStart(ctx, { id, cost: '300' }))

    const conversion = liveAccountAt(ledger.db, 'equity:conversion') ?? ''
    const opening = liveAccountAt(ledger.db, 'equity:opening') ?? ''
    expect(transaction).toBe(start?.id)
    expect(storedPostings(ledger, transaction)).toEqual([
      { accountId: id, amount: '200.00', currency: 'EUR' },
      { accountId: conversion, amount: '-200.00', currency: 'EUR' },
      { accountId: conversion, amount: '300.00', currency: 'CAD' },
      { accountId: opening, amount: '-300.00', currency: 'CAD' },
    ])
  })

  test('keeps the start’s day and description', () => {
    const { ctx, ledger, id, start } = wiseStarted()
    ok(
      editSpend(ctx, {
        id: start?.id ?? '',
        amount: '200',
        description: 'Wise',
        date: '2026-10-28',
      }),
    )

    ok(costStart(ctx, { id, cost: '300' }))

    expect(listTransactions(ledger.db)[0]).toMatchObject({
      date: '2026-10-28',
      description: 'Wise',
    })
  })

  test('the list says the cost from then on', () => {
    const { ctx, ledger, id } = wiseStarted()

    ok(costStart(ctx, { id, cost: '300' }))

    expect(listAccounts(ledger.db)[0]?.start?.cost).toEqual({ amount: '300.00', currency: 'CAD' })
  })

  test('undo puts the two postings back, and the list loses the cost', () => {
    const { ctx, ledger, id, start } = wiseStarted()
    ok(costStart(ctx, { id, cost: '300' }))

    ok(undoLast(ctx))

    expect(storedPostings(ledger, start?.id ?? '')).toHaveLength(2)
    expect(listAccounts(ledger.db)[0]?.start).not.toHaveProperty('cost')
  })

  test('names the step for the cost, for undo', () => {
    const { ctx, id } = wiseStarted()
    ok(costStart(ctx, { id, cost: '300' }))

    expect(undoItems(ctx.history, { undo: false, redo: false }).undo.label).toBe(
      'Undo cost of wise:eur',
    )
  })

  test('names it for redo too, once taken back', () => {
    const { ctx, id } = wiseStarted()
    ok(costStart(ctx, { id, cost: '300' }))
    ok(undoLast(ctx))

    expect(undoItems(ctx.history, { undo: false, redo: false }).redo.label).toBe(
      'Redo cost of wise:eur',
    )
  })

  test('a second cost is refused, and the postings stay', () => {
    const { ctx, ledger, id, start } = wiseStarted()
    ok(costStart(ctx, { id, cost: '300' }))
    const paid = storedPostings(ledger, start?.id ?? '')

    expect(refusal(costStart(ctx, { id, cost: '310' }))).toEqual({
      code: 'START_NOT_COSTABLE',
      details: { accountId: id },
    })
    expect(storedPostings(ledger, start?.id ?? '')).toEqual(paid)
  })

  test('with no start to cost is refused', () => {
    const { ctx } = setup()
    const { id } = ok(addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR' }))

    expect(refusal(costStart(ctx, { id, cost: '300' }))).toEqual({
      code: 'START_NOT_COSTABLE',
      details: { accountId: id },
    })
  })

  test('on a start in the home currency is refused', () => {
    const { ctx } = setup()
    const { id } = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '10' }),
    )

    expect(refusal(costStart(ctx, { id, cost: '300' }))).toEqual({
      code: 'START_NOT_COSTABLE',
      details: { accountId: id },
    })
  })

  test('that is not an amount is refused, and the postings are as they were', () => {
    const { ctx, ledger, id, start } = wiseStarted()

    expect(refusal(costStart(ctx, { id, cost: 'lots' }))).toEqual({
      code: 'COST_INVALID',
      details: { cost: 'lots' },
    })
    expect(storedPostings(ledger, start?.id ?? '')).toHaveLength(2)
  })

  test('on an account the file doesn’t hold is refused', () => {
    const { ctx } = setup()
    const missing = '7d1c2f3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

    expect(refusal(costStart(ctx, { id: missing, cost: '300' }))).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      details: { accountId: missing },
    })
  })

  test('on a category is refused, as a start is', () => {
    const { ctx, ledger } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const unsorted = liveAccountAt(ledger.db, 'expenses:unsorted') ?? ''

    expect(refusal(costStart(ctx, { id: unsorted, cost: '300' }))).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      details: { accountId: unsorted },
    })
  })
})
