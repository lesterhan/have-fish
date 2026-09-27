import { describe, expect, it } from 'bun:test'
import * as money from '../money'
import {
  categoryWeightsFor,
  computeSplits,
  payerShareRatio,
  splitNet,
  withExplicitWeights,
  withWeights,
} from './splits'

const m = (userId: string, shareWeight = 1) => ({ userId, shareWeight })

describe('computeSplits', () => {
  it('splits evenly when the amount divides', () => {
    expect(computeSplits('30.00', [m('a'), m('b'), m('c')], 'a')).toEqual([
      { userId: 'a', amount: '10.00' },
      { userId: 'b', amount: '10.00' },
      { userId: 'c', amount: '10.00' },
    ])
  })

  it('gives the rounding remainder to the payer, whoever the payer is', () => {
    expect(computeSplits('10.00', [m('a'), m('b'), m('c')], 'b')).toEqual([
      { userId: 'a', amount: '3.33' },
      { userId: 'b', amount: '3.34' },
      { userId: 'c', amount: '3.33' },
    ])
  })

  it('splits by weight', () => {
    expect(computeSplits('100.00', [m('a', 3), m('b', 1)], 'a')).toEqual([
      { userId: 'a', amount: '75.00' },
      { userId: 'b', amount: '25.00' },
    ])
  })

  it('always adds up to the amount', () => {
    for (const amount of ['0.01', '0.02', '1.00', '10.01', '99.99', '1234.57', '0.05']) {
      for (const weights of [
        [1, 1, 1],
        [1, 2],
        [3, 5, 7],
        [1, 1, 1, 1, 1, 1, 1],
      ]) {
        const members = weights.map((w, i) => m(`u${i}`, w))
        for (const payer of members) {
          const splits = computeSplits(amount, members, payer.userId)
          expect(money.sum(splits.map((s) => s.amount))).toBe(money.format(money.cents(amount)))
        }
      }
    }
  })

  it('refuses no members, or no weight', () => {
    expect(() => computeSplits('1.00', [], 'a')).toThrow('zero members')
    expect(() => computeSplits('1.00', [m('a', 0)], 'a')).toThrow('weight is zero')
  })
})

describe('category weights', () => {
  const members = [m('a'), m('b')]

  it('apply only when every member has one', () => {
    const all = new Map([
      ['a', 2],
      ['b', 1],
    ])
    expect(categoryWeightsFor(members, all)).toBe(all)
    expect(categoryWeightsFor(members, new Map([['a', 2]]))).toBeNull()
    expect(categoryWeightsFor([], all)).toBeNull()
  })

  it('replace the members’ own weights, or leave them when there are none', () => {
    expect(
      withWeights(
        members,
        new Map([
          ['a', 2],
          ['b', 5],
        ]),
      ),
    ).toEqual([m('a', 2), m('b', 5)])
    expect(withWeights(members, null)).toEqual(members)
  })

  it('give way to explicit per-expense weights for the members named', () => {
    expect(withExplicitWeights([m('a', 2), m('b', 2)], [m('b', 7)])).toEqual([m('a', 2), m('b', 7)])
  })
})

describe('payerShareRatio', () => {
  it('is the payer’s weight over the total', () => {
    expect(payerShareRatio([m('a', 1), m('b', 3)], 'a')).toBe(0.25)
  })

  it('counts a missing payer as weight 1, and a zero total as 0', () => {
    expect(payerShareRatio([m('a', 1)], 'z')).toBe(1)
    expect(payerShareRatio([m('a', 0)], 'a')).toBe(0)
  })
})

describe('splitNet', () => {
  it('rounds the payer’s share and gives the rest to the group, adding up to the net', () => {
    expect(splitNet(10, 1 / 3)).toEqual({ payerShare: '3.33', othersShare: '6.67' })
    expect(splitNet(-10, 0.5)).toEqual({ payerShare: '-5.00', othersShare: '-5.00' })
  })

  it('adds up to the net even when both halves would round the same way', () => {
    for (const net of [0.03, 0.05, 0.07, 1.01, -0.03, 12.35]) {
      for (const ratio of [0.5, 1 / 3, 0.25]) {
        const { payerShare, othersShare } = splitNet(net, ratio)
        expect(money.cents(payerShare) + money.cents(othersShare)).toBe(Math.round(net * 100))
      }
    }
  })
})
