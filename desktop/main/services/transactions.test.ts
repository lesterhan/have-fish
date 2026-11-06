import { describe, expect, test } from 'vitest'
import { contextFor } from '../context'
import type { Ledger } from '../db/ledger'
import { applyLocal } from '../ledger/apply'
import { anAccount, aSpend, MANUAL, NOW, ok, tempLedger } from '../ledger/fixtures'
import { removeSpend, writeSpend } from './spends'
import {
  listTransactions,
  pageOfTransactions,
  positionOf,
  transactionsWithIds,
} from './transactions'

const DAY = 86_400_000

function setup() {
  const ledger = tempLedger()
  const clock = { at: NOW, now: () => clock.at, timeZone: () => 'UTC' }
  const ctx = contextFor(ledger, () => {}, clock)
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

/** `n` spends a day apart, ending today, written as one batch: about ten years at 50,000. */
function aLedgerOf(n: number): Ledger {
  const ledger = tempLedger()
  const from = anAccount({ path: 'liabilities:visa', kind: 'card' })
  const to = anAccount({ path: 'expenses:food', kind: 'category' })
  const day = (i: number) => new Date(NOW - Math.floor(i / 14) * DAY).toISOString().slice(0, 10)
  const spends = Array.from({ length: n }, (_, i) =>
    aSpend(from.id, to.id, '12.50', {
      date: day(i),
      description: `Spend ${i}`,
      origin: { ...MANUAL, createdAt: NOW - i },
    }),
  )
  ok(applyLocal(ledger, [from, to, ...spends], NOW))
  return ledger
}

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
    const ledger = aLedgerOf(50_000)
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
