import { randomUUID } from 'node:crypto'
import type { RateDoc, TransactionDoc } from '@have-fish/core/documents'
import { afterAll, describe, expect, test } from 'vitest'
import type { InputOf } from '../../../shared/commands'
import { contextFor, type Time } from '../../context'
import { applyLocal } from '../../ledger/apply'
import {
  aLedgerOf,
  anAccount,
  aRate,
  aSpend,
  MANUAL,
  NOW,
  ok,
  openTempLedger,
  recorded,
  SYSTEM,
  tempLedger,
} from '../../ledger/fixtures'
import { addAccount } from '../accounts/accounts'
import { removeSpend, writeSpend } from '../spends/spends'
import { spendingIn } from './reports'

function setup() {
  const ledger = tempLedger()
  const clock: Time = { now: () => NOW, timeZone: () => 'UTC' }
  const ctx = contextFor({ ledger, announce: () => {}, time: clock })
  /** A spend from `from` (the wallet when left out) to a category, or to an account of mine. */
  const spend = (
    amount: string,
    to: string | { account: string },
    date = '2026-10-29',
    from: string | null = null,
  ) =>
    ok(
      writeSpend(ctx, {
        amount,
        description: '',
        to: typeof to === 'string' ? { category: to } : to,
        from,
        date,
      }),
    ).id
  const week = (start = '2026-10-26', end = '2026-11-01') =>
    ok(spendingIn(ledger.db, { start, end }))
  /** Each spend as `category amount`, and `''` for unsorted. */
  const lines = (start?: string, end?: string) =>
    week(start, end).spent.map((s) => `${s.category} ${s.amount}`)
  /** An account the app makes, kept to `currency`, with `start` when it is given one. */
  const account = (
    name: string,
    kind: InputOf<'account.add'>['kind'],
    currency: string,
    start = '',
  ) => ({ id: ok(addAccount(ctx, { name, kind, currency, start })).id, currency })
  /** The account every exchange here goes through, as the app writes one. */
  const via = anAccount({ path: 'equity:conversion', kind: 'conversion' })
  ok(applyLocal(ledger, [via], NOW))
  /** `paid` from `from` into `got` in `to` on `date`: the four postings an exchange has. */
  const exchange = (
    date: string,
    from: { id: string; currency: string },
    paid: string,
    to: { id: string; currency: string },
    got: string,
  ) => {
    const doc: TransactionDoc = {
      type: 'transaction',
      id: randomUUID(),
      date,
      description: 'Exchange',
      postings: [
        { accountId: from.id, amount: `-${paid}`, currency: from.currency },
        { accountId: via.id, amount: paid, currency: from.currency },
        { accountId: via.id, amount: `-${got}`, currency: to.currency },
        { accountId: to.id, amount: got, currency: to.currency },
      ],
      deletedAt: null,
      origin: MANUAL,
    }
    ok(applyLocal(ledger, [doc], NOW))
  }
  /** A rate document: typed, unless it says it was fetched. */
  const rate = (fields: Partial<RateDoc>) => ok(applyLocal(ledger, [aRate(fields)], NOW))
  return { ledger, ctx, spend, week, lines, account, exchange, rate }
}

/** A ledger with a card kept to `currency`, and ¥`amount` dinners from it, charged `charged`. */
function withCard(name = 'visa', currency = 'CAD', charged = '36.20', amount = '4000') {
  const made = setup()
  const card = ok(addAccount(made.ctx, { name, kind: 'card', currency })).id
  const dinner = (category = '', date = '2026-10-28') =>
    ok(
      writeSpend(made.ctx, {
        amount,
        currency: 'JPY',
        charged,
        description: 'Dinner',
        to: { category },
        from: card,
        date,
      }),
    ).id
  return { ...made, dinner }
}

describe('spendingIn', () => {
  test('nothing written: nothing spent, in the home currency', () => {
    const { week } = setup()
    expect(week()).toEqual({ currency: 'CAD', spent: [] })
  })

  test('each spend to a category, by its name without the root, oldest day first', () => {
    const { spend, week } = setup()
    const coffee = spend('4.50', 'food:coffee', '2026-10-29')
    const bus = spend('3.30', 'transport', '2026-10-27')

    expect(week().spent).toEqual([
      { id: bus, category: 'transport', amount: '3.30', mark: 'exact' },
      { id: coffee, category: 'food:coffee', amount: '4.50', mark: 'exact' },
    ])
  })

  test('unsorted is the empty category', () => {
    const { spend, lines } = setup()
    spend('9', '')
    expect(lines()).toEqual([' 9.00'])
  })

  test('both ends of the period are in it, and the days around it are not', () => {
    const { spend, lines } = setup()
    spend('1', 'a', '2026-10-25')
    spend('2', 'b', '2026-10-26')
    spend('3', 'c', '2026-11-01')
    spend('4', 'd', '2026-11-02')
    expect(lines()).toEqual(['b 2.00', 'c 3.00'])
    expect(lines('2026-10-29', '2026-10-29')).toEqual([])
  })

  test('transfers between my accounts, and starting balances, are not spending', () => {
    const { ctx, spend, lines } = setup()
    const chequing = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '1000' }),
    ).id
    const cash = ok(addAccount(ctx, { name: 'cash', kind: 'cash', currency: null })).id
    spend('100', { account: cash }, '2026-10-29', chequing)
    spend('12', 'food', '2026-10-29', cash)

    expect(lines()).toEqual(['food 12.00'])
  })

  test('income is not spending', () => {
    const { ctx, ledger, lines } = setup()
    const chequing = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' })).id
    const salary = anAccount({ path: 'income:salary', kind: 'income' })
    ok(applyLocal(ledger, [salary, aSpend(salary.id, chequing, '2000.00')], NOW))

    expect(lines()).toEqual([])
  })

  test('a removed spend is gone from it', () => {
    const { ctx, spend, lines } = setup()
    const id = spend('5', 'food')
    spend('6', 'fun')
    ok(removeSpend(ctx, { id }))
    expect(lines()).toEqual(['fun 6.00'])
  })

  test('four postings that are no conversion count each category', () => {
    const { ledger, lines } = setup()
    const wallet = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const fun = anAccount({ path: 'expenses:fun', kind: 'category' })
    const split = aSpend(wallet.id, food.id, '4.50', {
      postings: [
        { accountId: food.id, amount: '2.00', currency: 'CAD' },
        { accountId: fun.id, amount: '2.50', currency: 'CAD' },
        { accountId: wallet.id, amount: '-2.00', currency: 'CAD' },
        { accountId: wallet.id, amount: '-2.50', currency: 'CAD' },
      ],
    })
    ok(applyLocal(ledger, [wallet, food, fun, split], NOW))

    expect(lines()).toEqual(['food 2.00', 'fun 2.50'])
  })

  test.each([
    ['2026-02-30', '2026-03-01', '2026-02-30'],
    ['2026-10-26', 'next week', 'next week'],
    ['2026-11-01', '2026-10-26', '2026-10-26'],
  ])('a period from %s to %s is refused, naming %s', (start, end, date) => {
    const { ledger } = setup()
    expect(spendingIn(ledger.db, { start, end })).toEqual({
      ok: false,
      failure: { code: 'DATE_INVALID', details: { date } },
    })
  })
})

describe('a yen dinner my card was charged for', () => {
  test('charged 36.20 CAD, to no category: unsorted counts the 36.20', () => {
    const { dinner, week } = withCard()
    const id = dinner()
    expect(week().spent).toEqual([{ id, category: '', amount: '36.20', mark: 'exact' }])
  })

  test('to food: food counts the 36.20', () => {
    const { dinner, week } = withCard()
    const id = dinner('food')
    expect(week().spent).toEqual([{ id, category: 'food', amount: '36.20', mark: 'exact' }])
  })

  test('between two CAD spends, oldest day first: it sits between them', () => {
    const { dinner, spend, week } = withCard()
    spend('4.50', 'food', '2026-10-27')
    dinner('food', '2026-10-28')
    spend('12.00', 'food', '2026-10-29')
    expect(week().spent.map((s) => s.amount)).toEqual(['4.50', '36.20', '12.00'])
  })

  test('a card kept to USD converts its 27.00 leg: the 4,000 JPY dinner is 37.26, marked estimate', () => {
    const { dinner, rate, week } = withCard('amex', 'USD', '27.00')
    rate({
      date: '2026-10-28',
      from: 'USD',
      to: 'CAD',
      rate: '1.38',
      published: '2026-10-28',
      origin: SYSTEM,
    })
    const id = dinner('food')

    expect(week().spent).toEqual([{ id, category: 'food', amount: '37.26', mark: 'estimate' }])
  })

  test('the week before counts it at its charge too', () => {
    const { dinner, week } = withCard()
    const id = dinner('', '2026-10-21')
    expect(week('2026-10-19', '2026-10-25').spent).toEqual([
      { id, category: '', amount: '36.20', mark: 'exact' },
    ])
  })
})

describe('a spend waiting for its charge', () => {
  test('its yen counts at the day’s typed rate, marked mine', () => {
    const { rate, week, dinner } = withCard('visa', 'CAD', '', '8400')
    const id = dinner('food', '2026-10-29')
    rate({ date: '2026-10-29', from: 'CAD', to: 'JPY', rate: '110' })

    expect(week().spent).toEqual([{ id, category: 'food', amount: '76.36', mark: 'mine' }])
  })

  test('with no rate on any day: 0.00, marked missing, never 0.00 exact', () => {
    const { week, dinner } = withCard('visa', 'CAD', '', '8400')
    const id = dinner('food', '2026-10-29')

    expect(week().spent).toEqual([
      {
        id,
        category: 'food',
        amount: '0.00',
        mark: 'missing',
        guess: { date: '2026-10-29', currency: 'JPY', from: null },
        uncounted: { amount: '8400.00', currency: 'JPY' },
      },
    ])
  })
})

describe('a spend in another currency', () => {
  test('the week’s exchange prices it: 200.00 CAD into 150.00 EUR makes 15.00 EUR cost 20.00', () => {
    const { account, exchange, spend, week } = setup()
    const chequing = account('chequing', 'bank', 'CAD', '1000')
    const wallet = account('cash:eur', 'cash', 'EUR')
    exchange('2026-10-26', chequing, '200.00', wallet, '150.00')
    const id = spend('15', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([{ id, category: 'food', amount: '20.00', mark: 'cost' }])
  })

  test('an exchange before the week prices it too: 150.00 EUR from January still costs 20.00', () => {
    const { account, exchange, spend, week } = setup()
    const wallet = account('cash:eur', 'cash', 'EUR')
    exchange('2026-01-05', account('chequing', 'bank', 'CAD', '1000'), '200.00', wallet, '150.00')
    const id = spend('15', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([{ id, category: 'food', amount: '20.00', mark: 'cost' }])
  })

  test('a typed rate on its day: 10.00 EUR at 1.45 is 14.50, marked mine', () => {
    const { account, rate, spend, week } = setup()
    const wallet = account('cash:eur', 'cash', 'EUR', '10')
    rate({ date: '2026-10-27', from: 'EUR', to: 'CAD', rate: '1.45' })
    const id = spend('10', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([{ id, category: 'food', amount: '14.50', mark: 'mine' }])
  })

  test('a fetched rate on its day: 10.00 EUR at 1.46 is 14.60, marked estimate', () => {
    const { account, rate, spend, week } = setup()
    const wallet = account('cash:eur', 'cash', 'EUR', '10')
    rate({
      date: '2026-10-27',
      from: 'EUR',
      to: 'CAD',
      rate: '1.46',
      published: '2026-10-27',
      origin: SYSTEM,
    })
    const id = spend('10', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([{ id, category: 'food', amount: '14.60', mark: 'estimate' }])
  })

  test('a rate from another day is borrowed: 10.00 EUR at 1.40 is 14.00, marked borrowed', () => {
    const { account, rate, spend, week } = setup()
    const wallet = account('cash:eur', 'cash', 'EUR', '10')
    rate({ date: '2026-10-20', from: 'EUR', to: 'CAD', rate: '1.40' })
    const id = spend('10', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([
      {
        id,
        category: 'food',
        amount: '14.00',
        mark: 'borrowed',
        guess: { date: '2026-10-27', currency: 'EUR', from: { date: '2026-10-20', rate: '1.4' } },
      },
    ])
  })

  test('a rate typed the other way round is flipped: 10.00 EUR at 1.429 is 14.29, marked borrowed', () => {
    const { account, rate, spend, week } = setup()
    const wallet = account('cash:eur', 'cash', 'EUR')
    rate({ date: '2026-10-20', from: 'CAD', to: 'EUR', rate: '0.7' })
    const id = spend('10', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([
      {
        id,
        category: 'food',
        amount: '14.29',
        mark: 'borrowed',
        guess: { date: '2026-10-27', currency: 'EUR', from: { date: '2026-10-20', rate: '1.429' } },
      },
    ])
  })

  test('no rate at all: 15.00 JPY counts 0.00, marked missing', () => {
    const { account, spend, week } = setup()
    const wallet = account('cash:jpy', 'cash', 'JPY')
    const id = spend('15', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([
      {
        id,
        category: 'food',
        amount: '0.00',
        mark: 'missing',
        guess: { date: '2026-10-27', currency: 'JPY', from: null },
        uncounted: { amount: '15.00', currency: 'JPY' },
      },
    ])
  })

  test('a currency bought with another: 46.00 EUR carried from 200.00 CAD through USD is 66.67', () => {
    const { account, exchange, spend, week } = setup()
    const dollars = account('cash:usd', 'cash', 'USD')
    const wallet = account('cash:eur', 'cash', 'EUR')
    exchange('2026-01-05', account('chequing', 'bank', 'CAD', '1000'), '200.00', dollars, '150.00')
    exchange('2026-10-20', dollars, '100.00', wallet, '92.00')
    const id = spend('46', 'food', '2026-10-27', wallet.id)

    expect(week().spent).toEqual([{ id, category: 'food', amount: '66.67', mark: 'cost' }])
  })

  test('a spend with no rate: the answer holds its currency and its spends, and nothing else', () => {
    const { account, spend, week } = setup()
    const wallet = account('cash:eur', 'cash', 'EUR', '15')
    spend('15', 'food', '2026-10-27', wallet.id)

    expect(Object.keys(week())).toEqual(['currency', 'spent'])
  })

  test('asked again with no write between: the week’s statement and the count, and no history or rates', () => {
    const { account, exchange, spend, week } = setup()
    const chequing = account('chequing', 'bank', 'CAD', '1000')
    const wallet = account('cash:eur', 'cash', 'EUR')
    exchange('2026-10-26', chequing, '200.00', wallet, '150.00')
    spend('15', 'food', '2026-10-27', wallet.id)
    week()

    const ran = recorded(() => week())

    expect(ran).toHaveLength(2)
    expect(ran[0]?.sql).toContain('between')
    expect(ran[1]?.sql).toContain('total_changes()')
  })

  test('a write drops the reading: the same week reads missing, then the exchange’s cost', () => {
    const { account, exchange, spend, week } = setup()
    const chequing = account('chequing', 'bank', 'CAD', '1000')
    const wallet = account('cash:eur', 'cash', 'EUR', '15')
    const id = spend('15', 'food', '2026-10-27', wallet.id)
    expect(week().spent).toEqual([
      {
        id,
        category: 'food',
        amount: '0.00',
        mark: 'missing',
        guess: { date: '2026-10-27', currency: 'EUR', from: null },
        uncounted: { amount: '15.00', currency: 'EUR' },
      },
    ])

    exchange('2026-10-26', chequing, '200.00', wallet, '150.00')

    expect(week().spent).toEqual([{ id, category: 'food', amount: '20.00', mark: 'cost' }])
  })
})

describe('the week shown and the week before, at ten years', { timeout: 120_000 }, () => {
  const temp = openTempLedger()
  afterAll(temp.dispose)
  const ledger = aLedgerOf(50_000, temp.ledger)
  /** Reports asks for both weeks after each load or change, together. */
  const weeks = [
    { start: '2026-10-26', end: '2026-11-01' },
    { start: '2026-10-19', end: '2026-10-25' },
  ]
  const week = (start: string, end: string) => ok(spendingIn(ledger.db, { start, end }))

  test('both weeks together take under 20 ms, and each reads the date index', () => {
    const ran = recorded(() => {
      for (const { start, end } of weeks) expect(week(start, end).spent.length).toBeGreaterThan(0)
    })
    const took = ran.reduce((sum, r) => sum + r.ms, 0)
    // Measured at about 1.2 ms together. Loose for a slow runner.
    expect(took).toBeLessThan(20)

    const plans = ran.map(({ sql, args }) =>
      ledger.db
        .prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...args)
        .map((row) => row.detail),
    )
    expect(plans).toEqual([
      [
        'SEARCH transactions USING COVERING INDEX transactions_listed (date>? AND date<?)',
        'SEARCH postings USING INDEX sqlite_autoindex_postings_1 (transactionId=?)',
        'SEARCH accounts USING INDEX sqlite_autoindex_accounts_1 (id=?)',
        'USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY',
      ],
      [
        'SEARCH transactions USING COVERING INDEX transactions_listed (date>? AND date<?)',
        'SEARCH postings USING INDEX sqlite_autoindex_postings_1 (transactionId=?)',
        'SEARCH accounts USING INDEX sqlite_autoindex_accounts_1 (id=?)',
        'USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY',
      ],
    ])
  })
})

describe('a traveller’s two weeks, at ten years', { timeout: 120_000 }, () => {
  const temp = openTempLedger()
  afterAll(temp.dispose)
  const ledger = aLedgerOf(50_000, temp.ledger, 'traveller')
  /** Both weeks are in a trip, so each holds spends the week has to convert. */
  const weeks = [
    { start: '2026-10-26', end: '2026-11-01' },
    { start: '2026-10-19', end: '2026-10-25' },
  ]
  const week = (start: string, end: string) => ok(spendingIn(ledger.db, { start, end }))
  /** Both weeks, as the window's load asks them, each holding a spend in another currency. */
  const both = () => {
    for (const { start, end } of weeks) {
      expect(week(start, end).spent.some((s) => s.mark !== 'exact')).toBe(true)
    }
  }

  test('both weeks after a write take under 2,000 ms, and with none under 50 ms', () => {
    both()
    ok(applyLocal(ledger, [aRate()], NOW))
    const opened = performance.now()
    both()
    const read = performance.now() - opened
    const again = performance.now()
    both()
    const reused = performance.now() - again

    // Measured on a quiet laptop at about 180 ms after a write, and 1 ms with the reading kept.
    expect(read).toBeLessThan(2_000)
    expect(reused).toBeLessThan(50)
  })
})
