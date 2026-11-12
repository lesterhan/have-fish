import { calendarDateAt } from '@have-fish/core/calendar-date'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, test } from 'vitest'
import type { Changed } from '../../../shared/commands'
import { contextFor, type Time } from '../../context'
import { applyLocal } from '../../ledger/apply'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from '../../ledger/fixtures'
import { getDocument, liveAccountAt } from '../../ledger/store'
import { undoItems } from '../../undo/menu'
import { redoLast, undoLast } from '../../undo/steps'
import { removeSpend, writeSpend } from '../spends/spends'
import { listTransactions } from '../spends/transactions'
import { addAccount, balancesQuery, listAccounts, startAccount } from './accounts'

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
