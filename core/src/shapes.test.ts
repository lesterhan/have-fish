import { describe, expect, it } from 'vitest'
import type { AccountKind } from './account-kind'
import { amountOf, legsOf, type Shape, type ShapeLeg, shapeOf } from './shapes'

// One account of each kind, named by its letter; `g` is a second category.
const KINDS: Record<string, AccountKind> = {
  c: 'cash',
  b: 'bank',
  v: 'card',
  l: 'loan',
  f: 'category',
  g: 'category',
  i: 'income',
  o: 'opening',
  x: 'conversion',
}
const kindOf = (accountId: string) => KINDS[accountId]

const leg = (accountId: string, cents: number, currency = 'CAD'): ShapeLeg => ({
  accountId,
  cents,
  currency,
})

describe('shapeOf', () => {
  it('money from cash into a bank is a transfer, from the cash to the bank', () => {
    expect(shapeOf([leg('b', 450), leg('c', -450)], kindOf)).toEqual({
      shape: 'transfer',
      from: leg('c', -450),
      to: leg('b', 450),
    })
  })

  it('money from cash to a category is a spend, from the cash to the category', () => {
    expect(shapeOf([leg('f', 450), leg('c', -450)], kindOf)).toEqual({
      shape: 'spend',
      from: leg('c', -450),
      to: leg('f', 450),
    })
  })

  it('a card pays a category as cash does: a spend', () => {
    expect(shapeOf([leg('f', 450), leg('v', -450)], kindOf)).toMatchObject({ shape: 'spend' })
  })

  it('paying off a card from a bank is a transfer', () => {
    expect(shapeOf([leg('v', 300), leg('b', -300)], kindOf)).toMatchObject({ shape: 'transfer' })
  })

  it('paying a loan from a bank is a transfer', () => {
    expect(shapeOf([leg('l', 100), leg('b', -100)], kindOf)).toMatchObject({ shape: 'transfer' })
  })

  it('money from an income source into a bank is income, from the source to the bank', () => {
    expect(shapeOf([leg('b', 2000), leg('i', -2000)], kindOf)).toEqual({
      shape: 'income',
      from: leg('i', -2000),
      to: leg('b', 2000),
    })
  })

  it('a bank against the opening account is a start, of the bank', () => {
    expect(shapeOf([leg('b', 100), leg('o', -100)], kindOf)).toEqual({
      shape: 'start',
      account: leg('b', 100),
      opening: leg('o', -100),
    })
  })

  it('what I owe on a card goes on as a negative: a start, of the card', () => {
    expect(shapeOf([leg('v', -300), leg('o', 300)], kindOf)).toEqual({
      shape: 'start',
      account: leg('v', -300),
      opening: leg('o', 300),
    })
  })

  it('money into an income source is other, with its amount', () => {
    expect(shapeOf([leg('i', 5), leg('b', -5)], kindOf)).toEqual({
      shape: 'other',
      amount: { cents: 5, currency: 'CAD' },
    })
  })

  it('a refund, from a category into a bank, is other, with its amount', () => {
    expect(shapeOf([leg('b', 5), leg('f', -5)], kindOf)).toEqual({
      shape: 'other',
      amount: { cents: 5, currency: 'CAD' },
    })
  })

  it('income to a category is other, with its amount', () => {
    expect(shapeOf([leg('f', 5), leg('i', -5)], kindOf)).toEqual({
      shape: 'other',
      amount: { cents: 5, currency: 'CAD' },
    })
  })

  it('a bank against the conversion account is other, with its amount', () => {
    expect(shapeOf([leg('b', 5), leg('x', -5)], kindOf)).toEqual({
      shape: 'other',
      amount: { cents: 5, currency: 'CAD' },
    })
  })

  it('a posting whose account is not in the file yet is other, with its amount', () => {
    const notYet = (accountId: string) => (accountId === 'f' ? undefined : kindOf(accountId))
    expect(shapeOf([leg('f', 5), leg('c', -5)], notYet)).toEqual({
      shape: 'other',
      amount: { cents: 5, currency: 'CAD' },
    })
  })

  it('a split is other, with no one amount', () => {
    expect(shapeOf([leg('f', 3), leg('g', 2), leg('c', -5)], kindOf)).toEqual({
      shape: 'other',
      amount: null,
    })
  })

  it('two currencies are other, with no one amount', () => {
    const legs = [leg('i', 1000, 'JPY'), leg('x', -1000, 'JPY'), leg('x', 9), leg('b', -9)]
    expect(shapeOf(legs, kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('a tombstone has no postings: other, with no one amount', () => {
    expect(shapeOf([], kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('nothing moved: other, with no one amount', () => {
    expect(shapeOf([leg('f', 0), leg('c', -0)], kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('a yen spend a CAD card paid, through the conversion account, is converted', () => {
    const legs = [
      leg('f', 400000, 'JPY'),
      leg('x', -400000, 'JPY'),
      leg('x', 3620),
      leg('v', -3620),
    ]
    expect(shapeOf(legs, kindOf)).toEqual({
      shape: 'converted',
      from: leg('v', -3620),
      to: leg('f', 400000, 'JPY'),
      via: 'x',
    })
  })

  it('a converted spend reads the same whatever order its four legs are in', () => {
    const legs = [
      leg('v', -3620),
      leg('x', 3620),
      leg('f', 400000, 'JPY'),
      leg('x', -400000, 'JPY'),
    ]
    expect(shapeOf(legs, kindOf)).toEqual({
      shape: 'converted',
      from: leg('v', -3620),
      to: leg('f', 400000, 'JPY'),
      via: 'x',
    })
  })

  it('cash that holds any currency pays a converted spend too: read from the postings', () => {
    const legs = [
      leg('f', 400000, 'JPY'),
      leg('x', -400000, 'JPY'),
      leg('x', 3620),
      leg('c', -3620),
    ]
    expect(shapeOf(legs, kindOf)).toMatchObject({ shape: 'converted', from: leg('c', -3620) })
  })

  it('a conversion that does not balance in yen is other, with no one amount', () => {
    const legs = [
      leg('f', 400000, 'JPY'),
      leg('x', -390000, 'JPY'),
      leg('x', 3620),
      leg('v', -3620),
    ]
    expect(shapeOf(legs, kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('four legs through the conversion account in one currency are other', () => {
    const legs = [leg('f', 3620), leg('x', -3620), leg('x', 3620), leg('v', -3620)]
    expect(shapeOf(legs, kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('a category paying through the conversion account is other: a category cannot pay', () => {
    const legs = [
      leg('f', 400000, 'JPY'),
      leg('x', -400000, 'JPY'),
      leg('x', 3620),
      leg('g', -3620),
    ]
    expect(shapeOf(legs, kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('a converted spend with two more legs is other', () => {
    const legs = [
      leg('f', 400000, 'JPY'),
      leg('x', -400000, 'JPY'),
      leg('x', 3620),
      leg('v', -3620),
      leg('v', -100),
      leg('g', 100),
    ]
    expect(shapeOf(legs, kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('money from cash into euros in a bank, through the conversion account, is an exchange', () => {
    const legs = [leg('b', 8000, 'EUR'), leg('x', -8000, 'EUR'), leg('x', 10000), leg('c', -10000)]
    expect(shapeOf(legs, kindOf)).toEqual({
      shape: 'exchange',
      from: leg('c', -10000),
      to: leg('b', 8000, 'EUR'),
      via: 'x',
    })
  })

  it('dollars into euros inside one bank, through the conversion account, is an exchange', () => {
    const legs = [leg('b', 8000, 'EUR'), leg('x', -8000, 'EUR'), leg('x', 10000), leg('b', -10000)]
    expect(shapeOf(legs, kindOf)).toEqual({
      shape: 'exchange',
      from: leg('b', -10000),
      to: leg('b', 8000, 'EUR'),
      via: 'x',
    })
  })

  it('an exchange reads the same with its paying leg first and its getting leg last', () => {
    const legs = [leg('c', -10000), leg('x', -8000, 'EUR'), leg('x', 10000), leg('b', 8000, 'EUR')]
    expect(shapeOf(legs, kindOf)).toEqual({
      shape: 'exchange',
      from: leg('c', -10000),
      to: leg('b', 8000, 'EUR'),
      via: 'x',
    })
  })

  it('four legs between my accounts through the conversion account in one currency are other', () => {
    const legs = [leg('b', 10000), leg('x', -10000), leg('x', 10000), leg('c', -10000)]
    expect(shapeOf(legs, kindOf)).toEqual({ shape: 'other', amount: null })
  })

  it('the legs in either order give the same shape', () => {
    expect(shapeOf([leg('c', -450), leg('f', 450)], kindOf)).toEqual({
      shape: 'spend',
      from: leg('c', -450),
      to: leg('f', 450),
    })
  })
})

describe('legsOf', () => {
  it('a spend is written to, then from, and reads back as the same spend', () => {
    const spend: Shape = { shape: 'spend', from: leg('c', -450), to: leg('f', 450) }
    expect(legsOf(spend)).toEqual([leg('f', 450), leg('c', -450)])
    expect(shapeOf(legsOf(spend), kindOf)).toEqual(spend)
  })

  it('each shape the app writes reads back as itself: spend, transfer, income and start', () => {
    const shapes = [
      { shape: 'spend', from: leg('v', -450), to: leg('f', 450) },
      { shape: 'transfer', from: leg('b', -300), to: leg('v', 300) },
      { shape: 'income', from: leg('i', -2000), to: leg('b', 2000) },
      { shape: 'start', account: leg('b', 100), opening: leg('o', -100) },
      { shape: 'start', account: leg('v', -300), opening: leg('o', 300) },
    ] as const
    for (const shape of shapes) expect(shapeOf(legsOf(shape), kindOf)).toEqual(shape)
  })

  it('a converted spend is written to, the conversion each way, then from', () => {
    expect(legsOf({ from: leg('v', -3620), to: leg('f', 400000, 'JPY'), via: 'x' })).toEqual([
      leg('f', 400000, 'JPY'),
      leg('x', -400000, 'JPY'),
      leg('x', 3620),
      leg('v', -3620),
    ])
  })
})

describe('amountOf', () => {
  it('the one amount: a spend’s, a card start’s as positive, and none for a split', () => {
    expect(amountOf({ shape: 'spend', from: leg('c', -450), to: leg('f', 450) })).toEqual({
      cents: 450,
      currency: 'CAD',
    })
    expect(amountOf({ shape: 'start', account: leg('v', -300), opening: leg('o', 300) })).toEqual({
      cents: 300,
      currency: 'CAD',
    })
    expect(amountOf(shapeOf([leg('f', 3), leg('g', 2), leg('c', -5)], kindOf))).toBeNull()
  })

  it('a bank start’s amount is the account’s positive leg, not the opening’s', () => {
    expect(amountOf({ shape: 'start', account: leg('b', 100), opening: leg('o', -100) })).toEqual({
      cents: 100,
      currency: 'CAD',
    })
  })

  it('a converted spend’s amount is what it cost in its own currency, the yen', () => {
    const converted: Shape = {
      shape: 'converted',
      from: leg('v', -3620),
      to: leg('f', 400000, 'JPY'),
      via: 'x',
    }
    expect(amountOf(converted)).toEqual({ cents: 400000, currency: 'JPY' })
  })

  it('an exchange’s amount is what arrived, the euros', () => {
    const exchange: Shape = {
      shape: 'exchange',
      from: leg('c', -10000),
      to: leg('b', 8000, 'EUR'),
      via: 'x',
    }
    expect(amountOf(exchange)).toEqual({ cents: 8000, currency: 'EUR' })
  })
})
