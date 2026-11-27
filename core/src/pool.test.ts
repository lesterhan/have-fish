import { describe, expect, it } from 'vitest'
import type { AccountKind } from './account-kind'
import { addDays } from './calendar-date'
import { costOn, type PoolDay, type Pools, type PoolTransaction, poolsOf } from './pool'
import { convert, type Rate, significant } from './rates'
import type { ShapeLeg } from './shapes'

// One account of each kind the examples name, by its letter.
const KINDS: Record<string, AccountKind> = {
  w: 'bank',
  w2: 'cash',
  c: 'bank',
  v: 'card',
  j: 'bank',
  x: 'conversion',
  o: 'opening',
  i: 'income',
  f: 'category',
  fee: 'category',
}
const kindOf = (accountId: string) => KINDS[accountId]

const leg = (accountId: string, cents: number, currency: string): ShapeLeg => ({
  accountId,
  cents,
  currency,
})
const tx = (date: string, ...legs: ShapeLeg[]): PoolTransaction => ({ date, legs })

const HOME = 'CAD'
const pools = (transactions: readonly PoolTransaction[]): Pools =>
  poolsOf(transactions, kindOf, HOME)

/** The day `costOn` answers, which a test expects to be there. */
const day = (all: Pools, currency: string, date: string): PoolDay => {
  const found = costOn(all, currency, date)
  if (found === null) throw new Error(`nothing was held in ${currency} on ${date}`)
  return found
}

/** The rate of a day, which a test expects to be there. */
const rateOf = (held: PoolDay): Rate => {
  if (held.rate === null) throw new Error(`${held.date} has no rate`)
  return held.rate
}

/** `paid` home cents buying `cents` of `currency` into `accountId` on `date`, through `x`. */
const boughtWithCad = (
  date: string,
  accountId: string,
  currency: string,
  cents: number,
  paid: number,
): PoolTransaction =>
  tx(
    date,
    leg(accountId, cents, currency),
    leg('x', -cents, currency),
    leg('x', paid, 'CAD'),
    leg('c', -paid, 'CAD'),
  )

/** `cents` of EUR spent from `accountId` to `f` on `date`. */
const spend = (date: string, cents: number, accountId = 'w'): PoolTransaction =>
  tx(date, leg('f', cents, 'EUR'), leg(accountId, -cents, 'EUR'))

/** 200 CAD into 150 EUR on 05-01, through the conversion account. */
const ONE = [boughtWithCad('2026-05-01', 'w', 'EUR', 15000, 20000)]

/** (ONE), then 100 of those EUR spent on 05-03. */
const SPEND_KEEPS = [...ONE, spend('2026-05-03', 10000)]

/** 200 CAD into 138 EUR on 05-07, through the conversion account. */
const SECOND_EXCHANGE = boughtWithCad('2026-05-07', 'w', 'EUR', 13800, 20000)

/** (SPEND_KEEPS), then (SECOND_EXCHANGE), its 2.00 fee a spend apart. */
const EXAMPLE = [
  ...SPEND_KEEPS,
  SECOND_EXCHANGE,
  tx('2026-05-07', leg('fee', 200, 'CAD'), leg('c', -200, 'CAD')),
]

/** EUR started with on 04-01, of no known cost. */
const UNKNOWN_START = [tx('2026-04-01', leg('w', 20000, 'EUR'), leg('o', -20000, 'EUR'))]

/** (UNKNOWN_START), (ONE), then the 05-03 spend: 50 EUR known, 200 not. */
const POOL_FIRST = [...UNKNOWN_START, ...ONE, spend('2026-05-03', 10000)]

/** (POOL_FIRST), then 80 EUR spent on 05-04, past the known money. */
const PAST_KNOWN = [...POOL_FIRST, spend('2026-05-04', 8000)]

/** A card kept to EUR, owed 200 that cost 300 CAD, on the day given. */
const owedStart = (date: string) =>
  tx(
    date,
    leg('v', -20000, 'EUR'),
    leg('x', 20000, 'EUR'),
    leg('x', -30000, 'CAD'),
    leg('o', 30000, 'CAD'),
  )

/** 100 EUR spent on the card on 05-01, then 140 CAD paid in on 05-02 to settle it. */
const PAYS_DEBT = [
  spend('2026-05-01', 10000, 'v'),
  boughtWithCad('2026-05-02', 'v', 'EUR', 10000, 14000),
]

/** 100 EUR of the pool changed into 16,000 JPY on `date`, through the conversion account. */
const chainInto = (date: string) =>
  tx(
    date,
    leg('j', 1600000, 'JPY'),
    leg('x', -1600000, 'JPY'),
    leg('x', 10000, 'EUR'),
    leg('w', -10000, 'EUR'),
  )

/** Fifty thousand transactions over ten years: one in ten an exchange from CAD, the rest spends. */
function tenYears(): PoolTransaction[] {
  return Array.from({ length: 50_000 }, (_, i) => {
    const date = addDays('2016-01-01', Math.floor((i * 3650) / 50000))
    const euros = Math.floor(i / 10) % 2 === 0
    if (i % 10 === 0) {
      return euros
        ? boughtWithCad(date, 'w', 'EUR', 15000, 20000)
        : boughtWithCad(date, 'j', 'JPY', 1600000, 20000)
    }
    return euros ? spend(date, 500) : tx(date, leg('f', 40000, 'JPY'), leg('j', -40000, 'JPY'))
  })
}

describe('what a currency cost me', () => {
  it('one exchange out of the home currency sets the rate', () => {
    expect(day(pools(ONE), 'EUR', '2026-05-01')).toEqual({
      date: '2026-05-01',
      rate: { num: 4n, den: 3n },
      known: 15000,
      unknown: 0,
    })
  })

  it('a spend lowers what is held and leaves the rate', () => {
    const held = day(pools(SPEND_KEEPS), 'EUR', '2026-05-03')
    expect(held.rate).toEqual(day(pools(ONE), 'EUR', '2026-05-01').rate)
    expect(held.known).toBe(5000)
  })

  it('a second exchange averages what is still held with what arrived', () => {
    expect(day(pools(EXAMPLE), 'EUR', '2026-05-07')).toEqual({
      date: '2026-05-07',
      rate: { num: 26666666667n, den: 18800000000n },
      known: 18800,
      unknown: 0,
    })
  })

  it('shows the average to five figures: 1.4184, and 1.3333 before', () => {
    const all = pools(EXAMPLE)
    expect(significant(rateOf(day(all, 'EUR', '2026-05-07')), 5)).toBe('1.4184')
    expect(significant(rateOf(day(all, 'EUR', '2026-05-01')), 5)).toBe('1.3333')
  })

  it('converts 100 EUR at the average into 14,184 cents', () => {
    expect(convert(10000, rateOf(day(pools(EXAMPLE), 'EUR', '2026-05-07')))).toBe(14184)
  })

  it('a day between two of them takes the one before it', () => {
    expect(day(pools(EXAMPLE), 'EUR', '2026-05-05')).toEqual({
      date: '2026-05-03',
      rate: { num: 4n, den: 3n },
      known: 5000,
      unknown: 0,
    })
  })

  it('a day before the first of them answers null', () => {
    expect(costOn(pools(EXAMPLE), 'EUR', '2026-04-30')).toBeNull()
  })

  it('the home currency is never pooled', () => {
    expect(costOn(pools(EXAMPLE), 'CAD', '2026-05-07')).toBeNull()
  })

  it('moving money between my accounts changes nothing', () => {
    const moved = [...EXAMPLE, tx('2026-05-04', leg('w2', 5000, 'EUR'), leg('w', -5000, 'EUR'))]
    expect(pools(moved).get('EUR')).toEqual(pools(EXAMPLE).get('EUR'))
  })

  it('an awaiting spend moves nothing: the yen reads as with no transaction at all', () => {
    const waiting = tx(
      '2026-05-03',
      leg('f', 840000, 'JPY'),
      leg('x', -840000, 'JPY'),
      leg('x', 0, 'CAD'),
      leg('v', 0, 'CAD'),
    )
    expect(pools([waiting])).toEqual(pools([]))
  })

  it("a spend listed before its day's exchange takes the rate after it", () => {
    const spendFirst = [spend('2026-05-01', 10000), ...ONE]
    expect(day(pools(spendFirst), 'EUR', '2026-05-01')).toEqual({
      date: '2026-05-01',
      rate: { num: 4n, den: 3n },
      known: 5000,
      unknown: 0,
    })
  })

  it('the order the transactions come in changes nothing', () => {
    expect(pools([...EXAMPLE].reverse())).toEqual(pools(EXAMPLE))
  })

  it('a start with no cost is held apart, with no rate', () => {
    expect(day(pools(UNKNOWN_START), 'EUR', '2026-04-01')).toEqual({
      date: '2026-04-01',
      rate: null,
      known: 0,
      unknown: 20000,
    })
  })

  it('a spend uses known-cost money first and the rate holds', () => {
    expect(day(pools(POOL_FIRST), 'EUR', '2026-05-03')).toEqual({
      date: '2026-05-03',
      rate: { num: 4n, den: 3n },
      known: 5000,
      unknown: 20000,
    })
  })

  it('what is left is of unknown cost, past the known money', () => {
    expect(day(pools(PAST_KNOWN), 'EUR', '2026-05-04')).toEqual({
      date: '2026-05-04',
      rate: { num: 4n, den: 3n },
      known: 0,
      unknown: 17000,
    })
  })

  it('an arrival after the known money is gone prices itself alone', () => {
    const held = day(pools([...PAST_KNOWN, SECOND_EXCHANGE]), 'EUR', '2026-05-07')
    expect(significant(rateOf(held), 5)).toBe('1.4493')
    expect(held.known).toBe(13800)
  })

  it('income arrives of unknown cost, with no rate', () => {
    expect(
      day(
        pools([tx('2026-05-01', leg('w', 10000, 'EUR'), leg('i', -10000, 'EUR'))]),
        'EUR',
        '2026-05-01',
      ),
    ).toEqual({ date: '2026-05-01', rate: null, known: 0, unknown: 10000 })
  })

  it('a refund is of unknown cost beside what is held at a cost', () => {
    const refunded = [...ONE, tx('2026-05-02', leg('w', 1000, 'EUR'), leg('f', -1000, 'EUR'))]
    expect(day(pools(refunded), 'EUR', '2026-05-02')).toEqual({
      date: '2026-05-02',
      rate: { num: 4n, den: 3n },
      known: 15000,
      unknown: 1000,
    })
  })

  it('a start with its cost sets the rate', () => {
    const started = [
      tx(
        '2026-04-01',
        leg('w', 20000, 'EUR'),
        leg('x', -20000, 'EUR'),
        leg('x', 30000, 'CAD'),
        leg('o', -30000, 'CAD'),
      ),
    ]
    expect(day(pools(started), 'EUR', '2026-04-01')).toEqual({
      date: '2026-04-01',
      rate: { num: 3n, den: 2n },
      known: 20000,
      unknown: 0,
    })
  })

  it('a start I owe lowers what is held and sets the rate where there is none', () => {
    expect(day(pools([owedStart('2026-04-01')]), 'EUR', '2026-04-01')).toEqual({
      date: '2026-04-01',
      rate: { num: 3n, den: 2n },
      known: 0,
      unknown: -20000,
    })
  })

  it('a debt takes known-cost money first and leaves the rate', () => {
    expect(day(pools([...ONE, owedStart('2026-05-02')]), 'EUR', '2026-05-02')).toEqual({
      date: '2026-05-02',
      rate: { num: 4n, den: 3n },
      known: 0,
      unknown: -5000,
    })
  })

  it('euros changed into yen carry what the known euros cost', () => {
    const held = day(pools([...ONE, chainInto('2026-05-03')]), 'JPY', '2026-05-03')
    expect(significant(rateOf(held), 4)).toBe('0.008333')
    expect(held.known).toBe(1600000)
  })

  it("the euros' pool shows what the exchange took", () => {
    expect(day(pools([...ONE, chainInto('2026-05-03')]), 'EUR', '2026-05-03')).toEqual({
      date: '2026-05-03',
      rate: { num: 4n, den: 3n },
      known: 5000,
      unknown: 0,
    })
  })

  it('euros of unknown cost give yen of unknown cost', () => {
    expect(day(pools([...UNKNOWN_START, chainInto('2026-05-03')]), 'JPY', '2026-05-03')).toEqual({
      date: '2026-05-03',
      rate: null,
      known: 0,
      unknown: 1600000,
    })
  })

  it('a yen arrival listed before the euros takes its cost as the day orders it', () => {
    const held = day(pools([chainInto('2026-05-01'), ...ONE]), 'JPY', '2026-05-01')
    expect(significant(rateOf(held), 4)).toBe('0.008333')
  })

  it('an exchange into the home currency takes from the currency that left', () => {
    const soldBack = [
      ...ONE,
      tx(
        '2026-05-02',
        leg('c', 7000, 'CAD'),
        leg('x', -7000, 'CAD'),
        leg('x', 5000, 'EUR'),
        leg('w', -5000, 'EUR'),
      ),
    ]
    expect(day(pools(soldBack), 'EUR', '2026-05-02')).toEqual({
      date: '2026-05-02',
      rate: { num: 4n, den: 3n },
      known: 10000,
      unknown: 0,
    })
  })

  it("a debt listed before its day's exchange departs after it", () => {
    const debtFirst = [owedStart('2026-05-01'), ...ONE]
    expect(day(pools(debtFirst), 'EUR', '2026-05-01')).toEqual({
      date: '2026-05-01',
      rate: { num: 4n, den: 3n },
      known: 0,
      unknown: -5000,
    })
  })

  it('money of a known cost paid in settles what I owe', () => {
    expect(day(pools(PAYS_DEBT), 'EUR', '2026-05-02')).toEqual({
      date: '2026-05-02',
      rate: { num: 7n, den: 5n },
      known: 0,
      unknown: 0,
    })
  })

  it("the euros that settled a debt don't weigh the next average", () => {
    const settled = [...PAYS_DEBT, boughtWithCad('2026-05-05', 'w', 'EUR', 15000, 20000)]
    expect(day(pools(settled), 'EUR', '2026-05-05')).toEqual({
      date: '2026-05-05',
      rate: { num: 4n, den: 3n },
      known: 15000,
      unknown: 0,
    })
  })

  it('what is left over after a debt is held at its share of the cost', () => {
    const part = [
      spend('2026-05-01', 10000, 'v'),
      boughtWithCad('2026-05-02', 'w', 'EUR', 15000, 20000),
    ]
    expect(day(pools(part), 'EUR', '2026-05-02')).toEqual({
      date: '2026-05-02',
      rate: { num: 6666666667n, den: 5000000000n },
      known: 5000,
      unknown: 0,
    })
  })

  it("an exchange into a debt's currency settles part of it and leaves the rate", () => {
    const paid = [owedStart('2026-04-01'), ...ONE]
    expect(day(pools(paid), 'EUR', '2026-05-01')).toEqual({
      date: '2026-05-01',
      rate: { num: 3n, den: 2n },
      known: 0,
      unknown: -5000,
    })
  })

  it('a converted spend uses known-cost money and leaves the paid currency out', () => {
    const converted = [
      ...ONE,
      tx(
        '2026-05-02',
        leg('f', 400000, 'JPY'),
        leg('x', -400000, 'JPY'),
        leg('x', 2500, 'EUR'),
        leg('v', -2500, 'EUR'),
      ),
    ]
    const all = pools(converted)
    expect(day(all, 'EUR', '2026-05-02').known).toBe(12500)
    expect(costOn(all, 'JPY', '2026-05-02')).toBeNull()
  })

  it('one bank holding both currencies sets the rate from the two legs', () => {
    const inOneBank = [
      tx(
        '2026-05-01',
        leg('w', 8000, 'EUR'),
        leg('x', -8000, 'EUR'),
        leg('x', 10000, 'CAD'),
        leg('w', -10000, 'CAD'),
      ),
    ]
    expect(day(pools(inOneBank), 'EUR', '2026-05-01')).toEqual({
      date: '2026-05-01',
      rate: { num: 5n, den: 4n },
      known: 8000,
      unknown: 0,
    })
  })

  it('euros whose known money is used up give yen of unknown cost', () => {
    const all = pools([...PAST_KNOWN, chainInto('2026-05-05')])
    expect(day(all, 'JPY', '2026-05-05')).toEqual({
      date: '2026-05-05',
      rate: null,
      known: 0,
      unknown: 1600000,
    })
    expect(day(all, 'EUR', '2026-05-05')).toEqual({
      date: '2026-05-05',
      rate: { num: 4n, den: 3n },
      known: 0,
      unknown: 7000,
    })
  })

  it('only the share of yen bought with known-cost euros carries a cost', () => {
    const all = pools([...POOL_FIRST, chainInto('2026-05-04')])
    const held = day(all, 'JPY', '2026-05-04')
    expect(held.known).toBe(800000)
    expect(held.unknown).toBe(800000)
    expect(significant(rateOf(held), 4)).toBe('0.008333')
    expect(day(all, 'EUR', '2026-05-04')).toEqual({
      date: '2026-05-04',
      rate: { num: 4n, den: 3n },
      known: 0,
      unknown: 15000,
    })
  })

  it('pools fifty thousand transactions over ten years, warm, in under 250 ms', () => {
    const transactions = tenYears()
    pools(transactions)
    const began = performance.now()
    pools(transactions)
    // Measured at about 17 ms warm; the bound is loose so a slow runner doesn't fail it.
    expect(performance.now() - began).toBeLessThan(250)
  })
})
