import { describe, expect, test } from 'vitest'
import { contextFor } from '../context'
import type { Ledger } from '../db/ledger'
import { applyLocal } from '../ledger/apply'
import { aLedgerOf, anAccount, aSpend, NOW, ok, tempLedger } from '../ledger/fixtures'
import { liveAccountAt } from '../ledger/store'
import { addAccount } from './accounts'
import { removeSpend, writeSpend } from './spends'
import {
  daysOfTransactions,
  listTransactions,
  pageOfTransactions,
  positionOf,
  transactionsWithIds,
} from './transactions'

function setup() {
  const ledger = tempLedger()
  const clock = { at: NOW, now: () => clock.at, timeZone: () => 'UTC' }
  const ctx = contextFor({ ledger, announce: () => {}, time: clock })
  /** A spend on `date`, written a minute after the last. */
  const write = (description: string, date: string) => {
    clock.at += 60_000
    return ok(writeSpend(ctx, { amount: '4.50', description, date })).id
  }
  return { ledger, ctx, write }
}

/** Seven spends over three days, two of them on one day. */
function aWeek() {
  const s = setup()
  const ids = [
    s.write('Mon', '2026-10-26'),
    s.write('Wed', '2026-10-28'),
    s.write('Thu', '2026-10-29'),
    s.write('Wed again', '2026-10-28'),
    s.write('Thu again', '2026-10-29'),
    s.write('Mon again', '2026-10-26'),
    s.write('Thu last', '2026-10-29'),
  ]
  return { ...s, ids }
}

const names = (rows: { description: string }[]) => rows.map((t) => t.description)

/** One of each shape, as a file from another computer could hold it; a row by its description. */
function oneOfEach() {
  const ledger = tempLedger()
  const cash = anAccount()
  const bank = anAccount({ path: 'assets:chequing', kind: 'bank' })
  const visa = anAccount({ path: 'liabilities:visa', kind: 'card' })
  const food = anAccount({ path: 'expenses:food', kind: 'category' })
  const fun = anAccount({ path: 'expenses:fun', kind: 'category' })
  const salary = anAccount({ path: 'income:salary', kind: 'income' })
  const opening = anAccount({ path: 'equity:opening', kind: 'opening' })
  const split = [
    { accountId: cash.id, amount: '-10.00', currency: 'CAD' },
    { accountId: food.id, amount: '6.00', currency: 'CAD' },
    { accountId: fun.id, amount: '4.00', currency: 'CAD' },
  ]
  const refund = [
    { accountId: bank.id, amount: '5.00', currency: 'CAD' },
    { accountId: food.id, amount: '-5.00', currency: 'CAD' },
  ]
  ok(
    applyLocal(
      ledger,
      [
        ...[cash, bank, visa, food, fun, salary, opening],
        aSpend(cash.id, food.id, '4.50', { description: 'Spend' }),
        aSpend(bank.id, cash.id, '100.00', { description: 'Transfer' }),
        aSpend(salary.id, bank.id, '2000.00', { description: 'Income' }),
        aSpend(opening.id, bank.id, '100.00', { description: 'Bank start' }),
        aSpend(visa.id, opening.id, '50.00', { description: 'Card start' }),
        aSpend(cash.id, food.id, '10.00', { description: 'Split', postings: split }),
        aSpend(food.id, bank.id, '5.00', { description: 'Refund', postings: refund }),
      ],
      NOW,
    ),
  )
  const rows = listTransactions(ledger.db)
  return (description: string) => rows.find((r) => r.description === description)
}

describe('a page of the list', () => {
  test('newest day first, and the newest written first within a day', () => {
    const { ledger } = aWeek()
    expect(names(listTransactions(ledger.db))).toEqual([
      'Thu last',
      'Thu again',
      'Thu',
      'Wed again',
      'Wed',
      'Mon again',
      'Mon',
    ])
  })

  test('pages laid end to end are the whole list, each with the total', () => {
    const { ledger } = aWeek()
    const pages = [0, 3, 6].map((from) => pageOfTransactions(ledger.db, { from, limit: 3 }))
    expect(pages.map((p) => [p.from, p.total, p.rows.length])).toEqual([
      [0, 7, 3],
      [3, 7, 3],
      [6, 7, 1],
    ])
    expect(pages.flatMap((p) => p.rows)).toEqual(listTransactions(ledger.db))
  })

  test('past the end is empty, with the total', () => {
    const { ledger } = aWeek()
    expect(pageOfTransactions(ledger.db, { from: 50, limit: 10 })).toEqual({
      total: 7,
      from: 50,
      rows: [],
      nets: [],
    })
  })

  test('a removed spend leaves the list and the total', () => {
    const { ledger, ctx, ids } = aWeek()
    ok(removeSpend(ctx, { id: ids[2] as string }))
    const page = pageOfTransactions(ledger.db, { from: 0, limit: 10 })
    expect(page.total).toBe(6)
    expect(names(page.rows)).not.toContain('Thu')
  })
})

describe('a row as the list draws it', () => {
  test("carries its paths whole, so a tag can show each one's root", () => {
    const { ledger } = aWeek()
    expect(listTransactions(ledger.db)[0]).toMatchObject({
      from: 'cash',
      fromPath: 'assets:cash',
      to: 'unsorted',
      toPath: 'expenses:unsorted',
    })
  })

  test('where it came from: by hand, when, and on this computer', () => {
    const { ledger } = aWeek()
    expect(listTransactions(ledger.db)[0]?.origin).toMatchObject({
      source: 'manual',
      here: true,
      file: null,
      line: null,
    })
  })

  test('an import says its file and line, and that another computer made it', () => {
    const { ledger, ctx } = aWeek()
    const from = liveAccountAt(ledger.db, 'assets:cash')
    const to = liveAccountAt(ledger.db, 'expenses:unsorted')
    if (from === undefined || to === undefined) throw new Error('the wallet has no accounts')
    const imported = aSpend(from, to, '4.50', {
      date: '2026-11-04',
      description: 'Cafe',
      origin: {
        source: 'import',
        createdAt: NOW,
        deviceId: 'aabbccddeeff0011',
        file: 'wise-statement.csv',
        line: 15,
        text: 'CAFE',
      },
    })
    ok(ctx.apply([imported], NOW + 1_000_000))
    expect(listTransactions(ledger.db)[0]?.origin).toEqual({
      source: 'import',
      at: NOW,
      here: false,
      file: 'wise-statement.csv',
      line: 15,
    })
  })

  test('with no one From and To, has no paths', () => {
    const { ledger, ctx } = aWeek()
    const chequing = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' })).id
    ok(
      writeSpend(ctx, {
        amount: '20',
        description: 'Pay',
        from: { income: 'pay' },
        to: { account: chequing },
      }),
    )
    expect(listTransactions(ledger.db)[0]).toMatchObject({
      fromPath: 'income:pay',
      toPath: 'assets:chequing',
    })
  })
})

describe('a row’s shape', () => {
  test('each row carries its shape: spend, transfer, income, start, and other for a split', () => {
    const row = oneOfEach()
    expect(
      ['Spend', 'Transfer', 'Income', 'Bank start', 'Split'].map((d) => row(d)?.shape),
    ).toEqual(['spend', 'transfer', 'income', 'start', 'other'])
  })

  test('a spend, a transfer and income each list where the money came from and went to', () => {
    const row = oneOfEach()
    expect(row('Spend')).toMatchObject({ from: 'cash', to: 'food' })
    expect(row('Transfer')).toMatchObject({ from: 'chequing', to: 'cash' })
    expect(row('Income')).toMatchObject({ from: 'salary', to: 'chequing' })
  })

  test('a bank’s starting balance lists no From or To; a card’s lists the card as From', () => {
    const row = oneOfEach()
    expect(row('Bank start')).toMatchObject({ from: null, to: null, fromPath: null, toPath: null })
    expect(row('Card start')).toMatchObject({
      from: 'visa',
      to: null,
      fromPath: 'liabilities:visa',
      toPath: null,
    })
  })

  test('a bank’s starting balance of 100 lists its one amount, 100', () => {
    expect(oneOfEach()('Bank start')?.simple).toEqual({ amount: '100.00', currency: 'CAD' })
  })

  test('an other lists no From or To, and its amounts as before', () => {
    const row = oneOfEach()
    const none = { from: null, to: null, fromPath: null, toPath: null }
    expect(row('Refund')).toMatchObject({
      ...none,
      amounts: [{ amount: '5.00', currency: 'CAD' }],
      simple: { amount: '5.00', currency: 'CAD' },
    })
    expect(row('Split')).toMatchObject({
      ...none,
      amounts: [{ amount: '10.00', currency: 'CAD' }],
      simple: null,
    })
  })
})

describe('the days of the list', () => {
  test('how many rows each day has, newest day first', () => {
    const { ledger } = aWeek()
    expect(daysOfTransactions(ledger.db)).toEqual([
      { date: '2026-10-29', count: 3 },
      { date: '2026-10-28', count: 2 },
      { date: '2026-10-26', count: 2 },
    ])
  })

  test('a removed spend leaves its day, and a day with none left goes', () => {
    const { ledger, ctx, ids } = aWeek()
    ok(removeSpend(ctx, { id: ids[1] as string }))
    ok(removeSpend(ctx, { id: ids[3] as string }))
    expect(daysOfTransactions(ledger.db).map((d) => d.date)).toEqual(['2026-10-29', '2026-10-26'])
  })
})

describe("a page's day nets", () => {
  test("each day on the page, what came in less what went out, from SQL: the whole day's", () => {
    const { ledger } = aWeek()
    // The page holds two of Thursday's three; the net is all three.
    expect(pageOfTransactions(ledger.db, { from: 1, limit: 3 }).nets).toEqual([
      { date: '2026-10-29', net: [{ amount: '-13.50', currency: 'CAD' }] },
      { date: '2026-10-28', net: [{ amount: '-9.00', currency: 'CAD' }] },
    ])
  })

  test('money in counts up, a move between my accounts not at all, a starting balance not at all', () => {
    const { ledger, ctx } = setup()
    const chequing = ok(
      addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD', start: '500' }),
    ).id
    const date = '2026-10-29'
    ok(
      writeSpend(ctx, {
        amount: '40',
        description: 'Chair',
        from: { income: 'sales' },
        to: { account: chequing },
        date,
      }),
    )
    ok(writeSpend(ctx, { amount: '12.25', description: 'Lunch', from: chequing, date }))
    ok(
      writeSpend(ctx, {
        amount: '100',
        description: 'Cash',
        from: chequing,
        to: { account: ok(addAccount(ctx, { name: 'cash', kind: 'cash', currency: 'CAD' })).id },
        date: '2026-10-28',
      }),
    )
    const { nets } = pageOfTransactions(ledger.db, { from: 0, limit: 10 })
    expect(nets.find((d) => d.date === date)?.net).toEqual([{ amount: '27.75', currency: 'CAD' }])
    // A day with only a move between my accounts nets to nothing.
    expect(nets.find((d) => d.date === '2026-10-28')?.net).toEqual([])
  })

  test('each currency apart', () => {
    const { ledger, ctx } = setup()
    const date = '2026-10-29'
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', date }))
    const eur = ok(addAccount(ctx, { name: 'wise', kind: 'bank', currency: 'EUR' })).id
    ok(writeSpend(ctx, { amount: '35', description: 'Cafe', from: eur, date }))
    const { nets } = pageOfTransactions(ledger.db, { from: 0, limit: 10 })
    expect(nets).toEqual([
      {
        date,
        net: [
          { amount: '-4.50', currency: 'CAD' },
          { amount: '-35.00', currency: 'EUR' },
        ],
      },
    ])
  })
})

describe('where a spend is in the list', () => {
  test('its index, for every row', () => {
    const { ledger } = aWeek()
    const listed = listTransactions(ledger.db)
    expect(listed.map((t) => positionOf(ledger.db, t.id))).toEqual(listed.map((_, i) => i))
  })

  test('null once removed, or for one never written', () => {
    const { ledger, ctx, ids } = aWeek()
    const id = ids[0] as string
    ok(removeSpend(ctx, { id }))
    expect(positionOf(ledger.db, id)).toBeNull()
    expect(positionOf(ledger.db, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })
})

describe('spends by id', () => {
  test("the live ones, in the list's order, whatever order they're asked in", () => {
    const { ledger, ctx, ids } = aWeek()
    ok(removeSpend(ctx, { id: ids[1] as string }))
    const asked = [ids[0], ids[1], ids[6], ids[3], '00000000-0000-4000-8000-000000000000']
    expect(names(transactionsWithIds(ledger.db, asked as string[]))).toEqual([
      'Thu last',
      'Wed again',
      'Mon',
    ])
  })

  test('each as the list shows it', () => {
    const { ledger, ids } = aWeek()
    const listed = listTransactions(ledger.db)
    expect(transactionsWithIds(ledger.db, ids)).toEqual(listed)
  })

  test('none asked, none given', () => {
    const { ledger } = aWeek()
    expect(transactionsWithIds(ledger.db, [])).toEqual([])
  })
})

/** What SQLite does for `sql`, a line per step. */
const planOf = (ledger: Ledger, sql: string) =>
  ledger.db
    .prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => row.detail)

describe('at ten years', { timeout: 60_000 }, () => {
  test('a page, its total and a position read the index, and never sort', () => {
    const ledger = aLedgerOf(200)
    const page = planOf(
      ledger,
      `SELECT id, date, description FROM transactions WHERE deletedAt IS NULL
        ORDER BY date DESC, originCreatedAt DESC, version DESC, id DESC LIMIT 100 OFFSET 0`,
    )
    expect(page).toEqual(['SCAN transactions USING INDEX transactions_listed'])
    expect(planOf(ledger, 'SELECT count(*) FROM transactions WHERE deletedAt IS NULL')).toEqual([
      'SCAN transactions USING COVERING INDEX transactions_listed',
    ])
    const position = planOf(
      ledger,
      `SELECT count(*) FROM transactions WHERE deletedAt IS NULL
        AND (date, originCreatedAt, version, id) > ('2026-01-01', 0, 'v', 'x')`,
    )
    expect(position).toEqual([
      'SEARCH transactions USING COVERING INDEX transactions_listed ((date,originCreatedAt,version,id)>(?,?,?,?))',
    ])
  })

  test('the last page and a far position, quickly, over 50,000', () => {
    // Two starting balances, as well as the spends.
    const ledger = aLedgerOf(49_998)
    const last = listTransactions(ledger.db).at(-1)
    const started = performance.now()
    const page = pageOfTransactions(ledger.db, { from: 49_900, limit: 100 })
    const at = positionOf(ledger.db, last?.id as string)
    const took = performance.now() - started
    expect(page.total).toBe(50_000)
    expect(page.rows.at(-1)).toEqual(last)
    expect(at).toBe(49_999)
    // Measured at about 15 ms; the bound is loose so a slow runner doesn't fail it.
    expect(took).toBeLessThan(250)
  })
})
