import { describe, expect, it } from 'vitest'
import type { AccountKind } from './account-kind'
import { addDays } from './calendar-date'
import type { RateDoc } from './documents'
import type { PoolDay, Pools } from './pool'
import { MARKS, ownRate, rateBookOf, rateFor } from './rate-for'
import { type Rate, ratio } from './rates'
import { type ShapeLeg, shapeOf } from './shapes'

// One account of each kind the examples name, by its letter.
const KINDS: Record<string, AccountKind> = {
  c: 'bank',
  w: 'bank',
  x: 'conversion',
  f: 'category',
}
const kindOf = (accountId: string) => KINDS[accountId]

const leg = (accountId: string, cents: number, currency: string): ShapeLeg => ({
  accountId,
  cents,
  currency,
})

const MADE = { createdAt: Date.UTC(2026, 4, 1, 9), deviceId: 'a1b2c3d4e5f60718' }
const MANUAL = { source: 'manual', ...MADE } as const
const SYSTEM = { source: 'system', ...MADE } as const

/** A rate document, which the ledger's checks have already passed. */
const rateDoc = (
  date: string,
  from: string,
  to: string,
  rate: string,
  source: 'manual' | 'system',
  deletedAt: number | null = null,
): RateDoc => ({
  type: 'rate',
  id: '8a7283de-26e1-485d-8aef-414f2e2bfdf1',
  date,
  from,
  to,
  rate,
  published: source === 'system' ? date : null,
  deletedAt,
  origin: source === 'manual' ? MANUAL : SYSTEM,
})

/** A pool day: this file only reads its rate. */
const aDay = (date: string, rate: Rate | null): PoolDay => ({ date, rate, known: 0, unknown: 0 })

/** A pool holding one currency's days, and nothing else. */
const poolOf = (currency: string, ...days: PoolDay[]): Pools => new Map([[currency, days]])

const NO_POOLS: Pools = new Map()

const amount = (currency: string, date: string, own: Rate | null = null) => ({
  currency,
  date,
  own,
})

describe('the rate for one amount', () => {
  it('lists the marks best first', () => {
    expect(MARKS).toEqual(['exact', 'cost', 'mine', 'estimate', 'borrowed', 'missing'])
  })

  it('an amount already in the currency is exact at one', () => {
    expect(rateFor(amount('CAD', '2026-05-04'), NO_POOLS, rateBookOf([], 'CAD'), 'CAD')).toEqual({
      mark: 'exact',
      rate: { num: 1n, den: 1n },
    })
  })

  it('a converted spend pays its own rate over the pool and the book', () => {
    const pools = poolOf('JPY', aDay('2026-05-01', { num: 1n, den: 110n }))
    const book = rateBookOf([rateDoc('2026-05-04', 'JPY', 'CAD', '0.0091', 'manual')], 'CAD')
    expect(rateFor(amount('JPY', '2026-05-04', ratio(1600000, 14500)), pools, book, 'CAD')).toEqual(
      { mark: 'exact', rate: { num: 29n, den: 3200n } },
    )
  })

  it('the pool answers before a rate I typed', () => {
    const pools = poolOf('EUR', aDay('2026-05-01', { num: 4n, den: 3n }))
    const book = rateBookOf([rateDoc('2026-05-04', 'EUR', 'CAD', '1.45', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), pools, book, 'CAD')).toEqual({
      mark: 'cost',
      rate: { num: 4n, den: 3n },
    })
  })

  it('a pool day with no rate falls through to the book', () => {
    const pools = poolOf('EUR', aDay('2026-05-01', null))
    const book = rateBookOf([rateDoc('2026-05-04', 'EUR', 'CAD', '1.45', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), pools, book, 'CAD')).toEqual({
      mark: 'mine',
      rate: { num: 29n, den: 20n },
    })
  })

  it('the pool has nothing on or before the day, so the book answers', () => {
    const pools = poolOf('EUR', aDay('2026-05-06', { num: 4n, den: 3n }))
    const book = rateBookOf([rateDoc('2026-05-04', 'EUR', 'CAD', '1.45', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), pools, book, 'CAD')).toEqual({
      mark: 'mine',
      rate: { num: 29n, den: 20n },
    })
  })

  it('a rate I typed beats the fetched one on its day', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-04', 'EUR', 'CAD', '1.45', 'manual'),
        rateDoc('2026-05-04', 'EUR', 'CAD', '1.46', 'system'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'mine',
      rate: { num: 29n, den: 20n },
    })
  })

  it('a fetched rate with none typed is an estimate', () => {
    const book = rateBookOf([rateDoc('2026-05-04', 'EUR', 'CAD', '1.46', 'system')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'estimate',
      rate: { num: 73n, den: 50n },
    })
  })

  it('a rate document the other way round is inverted', () => {
    const book = rateBookOf([rateDoc('2026-05-04', 'CAD', 'EUR', '0.69', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'mine',
      rate: { num: 100n, den: 69n },
    })
  })

  it('a rate for a pair without the currency in it answers nothing', () => {
    const book = rateBookOf([rateDoc('2026-05-04', 'EUR', 'USD', '1.08', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'missing',
    })
  })

  it('a tombstoned rate is never the day’s rate', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-04', 'EUR', 'CAD', '1.45', 'manual', Date.UTC(2026, 4, 5)),
        rateDoc('2026-05-04', 'EUR', 'CAD', '1.46', 'system'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'estimate',
      rate: { num: 73n, den: 50n },
    })
  })

  it('a day with no rate borrows the nearest one before it', () => {
    const book = rateBookOf([rateDoc('2026-05-02', 'EUR', 'CAD', '1.40', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 7n, den: 5n },
      day: '2026-05-02',
    })
  })

  it('a day with no rate borrows the nearest one after it', () => {
    const book = rateBookOf([rateDoc('2026-05-07', 'EUR', 'CAD', '1.50', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 3n, den: 2n },
      day: '2026-05-07',
    })
  })

  it('the nearer day wins, not the one typed', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-01', 'EUR', 'CAD', '1.40', 'manual'),
        rateDoc('2026-05-06', 'EUR', 'CAD', '1.46', 'system'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 73n, den: 50n },
      day: '2026-05-06',
    })
  })

  it('equally near, the earlier day wins', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-02', 'EUR', 'CAD', '1.40', 'manual'),
        rateDoc('2026-05-06', 'EUR', 'CAD', '1.50', 'manual'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 7n, den: 5n },
      day: '2026-05-02',
    })
  })

  it('a typed rate beats a fetched one on a borrowed day', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-02', 'EUR', 'CAD', '1.40', 'manual'),
        rateDoc('2026-05-02', 'EUR', 'CAD', '1.41', 'system'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 7n, den: 5n },
      day: '2026-05-02',
    })
  })

  it('nearness counts days, across a month', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-04-30', 'EUR', 'CAD', '1.40', 'manual'),
        rateDoc('2026-05-07', 'EUR', 'CAD', '1.50', 'manual'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-03'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 7n, den: 5n },
      day: '2026-04-30',
    })
  })

  it('a rate from any way back is borrowed', () => {
    const book = rateBookOf([rateDoc('2026-03-01', 'EUR', 'CAD', '1.40', 'manual')], 'CAD')
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 7n, den: 5n },
      day: '2026-03-01',
    })
  })

  it('no rate anywhere is missing', () => {
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, rateBookOf([], 'CAD'), 'CAD')).toEqual({
      mark: 'missing',
    })
  })

  it('the book puts the days in order whatever order the documents come in', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-09', 'EUR', 'CAD', '1.50', 'manual'),
        rateDoc('2026-05-06', 'EUR', 'CAD', '1.46', 'system'),
        rateDoc('2026-05-01', 'EUR', 'CAD', '1.40', 'manual'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 73n, den: 50n },
      day: '2026-05-06',
    })
  })

  it('a borrowed rate comes from the neighbours, not the book’s ends', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-01', 'EUR', 'CAD', '1.40', 'manual'),
        rateDoc('2026-05-03', 'EUR', 'CAD', '1.42', 'manual'),
        rateDoc('2026-05-08', 'EUR', 'CAD', '1.48', 'manual'),
        rateDoc('2026-05-12', 'EUR', 'CAD', '1.50', 'manual'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-07'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 37n, den: 25n },
      day: '2026-05-08',
    })
  })

  it('each currency answers from its own days', () => {
    const book = rateBookOf(
      [
        rateDoc('2026-05-04', 'JPY', 'CAD', '0.0091', 'manual'),
        rateDoc('2026-05-02', 'EUR', 'CAD', '1.40', 'manual'),
      ],
      'CAD',
    )
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, book, 'CAD')).toEqual({
      mark: 'borrowed',
      rate: { num: 7n, den: 5n },
      day: '2026-05-02',
    })
  })

  it('a book into another currency answers from its own documents', () => {
    const docs = [
      rateDoc('2026-05-04', 'EUR', 'USD', '1.08', 'manual'),
      rateDoc('2026-05-04', 'EUR', 'CAD', '1.45', 'manual'),
    ]
    expect(rateFor(amount('EUR', '2026-05-04'), NO_POOLS, rateBookOf(docs, 'USD'), 'USD')).toEqual({
      mark: 'mine',
      rate: { num: 27n, den: 25n },
    })
  })

  it('reads ten years of rates and 50,000 amounts, warm, in under 250 ms', () => {
    const docs: RateDoc[] = []
    for (let day = 0; day < 3650; day += 2) {
      const date = addDays('2016-01-01', day)
      docs.push(rateDoc(date, 'EUR', 'CAD', '1.45', 'manual'))
      docs.push(rateDoc(date, 'EUR', 'CAD', '1.46', 'system'))
      docs.push(rateDoc(date, 'JPY', 'CAD', '0.0091', 'manual'))
      docs.push(rateDoc(date, 'JPY', 'CAD', '0.0092', 'system'))
    }
    const amounts = Array.from({ length: 50_000 }, (_, i) =>
      amount(i % 2 === 0 ? 'EUR' : 'JPY', addDays('2016-01-01', Math.floor((i * 3650) / 50_000))),
    )
    const rateEvery = () => {
      const book = rateBookOf(docs, 'CAD')
      for (const each of amounts) rateFor(each, NO_POOLS, book, 'CAD')
    }
    rateEvery()
    const began = performance.now()
    rateEvery()
    // Measured at about 22 ms warm; the bound is loose so a slow runner doesn't fail it.
    expect(performance.now() - began).toBeLessThan(250)
  })
})

describe('a converted spend’s own rate', () => {
  it('a converted spend paid in the currency gives the rate from its legs', () => {
    const legs = [
      leg('f', 1600000, 'JPY'),
      leg('x', -1600000, 'JPY'),
      leg('x', 14500, 'CAD'),
      leg('c', -14500, 'CAD'),
    ]
    expect(ownRate(shapeOf(legs, kindOf), 'CAD')).toEqual({ num: 29n, den: 3200n })
  })

  it('a converted spend paid in another currency gives no own rate', () => {
    const legs = [
      leg('f', 1600000, 'JPY'),
      leg('x', -1600000, 'JPY'),
      leg('x', 10000, 'EUR'),
      leg('w', -10000, 'EUR'),
    ]
    expect(ownRate(shapeOf(legs, kindOf), 'CAD')).toBeNull()
  })

  it('a spend gives no own rate', () => {
    const legs = [leg('f', 1000, 'CAD'), leg('c', -1000, 'CAD')]
    expect(ownRate(shapeOf(legs, kindOf), 'CAD')).toBeNull()
  })
})
