import { afterAll, describe, expect, test } from 'vitest'
import { contextFor, type Time } from '../context'
import { addAccount } from '../features/accounts/accounts'
import { removeSpend, writeSpend } from '../features/spends/spends'
import { applyLocal } from '../ledger/apply'
import {
  aLedgerOf,
  anAccount,
  aSpend,
  NOW,
  ok,
  openTempLedger,
  recorded,
  tempLedger,
} from '../ledger/fixtures'
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
  return { ledger, ctx, spend, week, lines }
}

describe('spendingIn', () => {
  test('nothing written: nothing spent, in the home currency', () => {
    const { week } = setup()
    expect(week()).toEqual({ currency: 'CAD', spent: [], other: [] })
  })

  test('each spend to a category, by its name without the root, oldest day first', () => {
    const { spend, week } = setup()
    const coffee = spend('4.50', 'food:coffee', '2026-10-29')
    const bus = spend('3.30', 'transport', '2026-10-27')

    expect(week().spent).toEqual([
      { id: bus, category: 'transport', amount: '3.30' },
      { id: coffee, category: 'food:coffee', amount: '4.50' },
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

  test('other currencies are summed apart, by code', () => {
    const { ctx, spend, week } = setup()
    const euros = ok(addAccount(ctx, { name: 'wise:eur', kind: 'bank', currency: 'EUR' })).id
    const yen = ok(addAccount(ctx, { name: 'suica', kind: 'cash', currency: 'JPY' })).id
    const loonies = ok(addAccount(ctx, { name: 'cash', kind: 'cash', currency: 'CAD' })).id
    spend('10', 'food', '2026-10-29', euros)
    spend('5', 'fun', '2026-10-29', euros)
    spend('500', 'transport', '2026-10-29', yen)
    spend('7', 'food', '2026-10-29', loonies)

    const { spent, other } = week()
    expect(spent.map((s) => s.amount)).toEqual(['7.00'])
    expect(other).toEqual([
      { amount: '15.00', currency: 'EUR' },
      { amount: '500.00', currency: 'JPY' },
    ])
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
