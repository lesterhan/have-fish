import { describe, expect, it } from 'bun:test'
import { imbalance } from '../ledger/validate'
import { type BatchLine, batchSettlementLegs, expenseMemberLegs, settlementLegs } from './legs'

// Every set of legs here is written by the ledger service, which refuses one that doesn't
// balance per currency. `imbalance` is that rule.

const accounts = { cash: 'cash', clearing: 'clearing', conversion: 'conv' }

describe('expenseMemberLegs', () => {
  const base = {
    sharedAccountId: 'clearing',
    expenseAccountId: 'food',
    currency: 'CAD',
    totalAmount: '30.00',
  }

  it('gives the payer payment, clearing for the others, and their own expense', () => {
    const legs = expenseMemberLegs({
      ...base,
      isPayer: true,
      paymentAccountId: 'bank',
      share: '10.00',
    })
    expect(legs).toEqual([
      { accountId: 'bank', amount: '-30.00', currency: 'CAD' },
      { accountId: 'clearing', amount: '20.00', currency: 'CAD' },
      { accountId: 'food', amount: '10.00', currency: 'CAD' },
    ])
    expect(imbalance(legs)).toBeNull()
  })

  it('leaves out the clearing leg when the payer owes it all', () => {
    const legs = expenseMemberLegs({
      ...base,
      isPayer: true,
      paymentAccountId: 'bank',
      share: '30.00',
    })
    expect(legs.map((l) => l.accountId)).toEqual(['bank', 'food'])
    expect(imbalance(legs)).toBeNull()
  })

  it('gives anyone else their expense and a debt on the clearing account', () => {
    const legs = expenseMemberLegs({
      ...base,
      isPayer: false,
      paymentAccountId: 'bank',
      share: '10.00',
    })
    expect(legs).toEqual([
      { accountId: 'food', amount: '10.00', currency: 'CAD' },
      { accountId: 'clearing', amount: '-10.00', currency: 'CAD' },
    ])
  })

  it('keeps the legacy signs for a payer with no source account', () => {
    const legs = expenseMemberLegs({
      ...base,
      isPayer: true,
      paymentAccountId: undefined,
      share: '10.00',
    })
    expect(legs).toEqual([
      { accountId: 'food', amount: '-10.00', currency: 'CAD' },
      { accountId: 'clearing', amount: '10.00', currency: 'CAD' },
    ])
  })
})

describe('settlementLegs', () => {
  it('moves cash out and credits clearing for the payer, the reverse for the receiver', () => {
    expect(settlementLegs('payer', accounts, '12.50', 'EUR')).toEqual([
      { accountId: 'cash', amount: '-12.50', currency: 'EUR' },
      { accountId: 'clearing', amount: '12.50', currency: 'EUR' },
    ])
    expect(settlementLegs('receiver', accounts, '12.50', 'EUR')).toEqual([
      { accountId: 'cash', amount: '12.50', currency: 'EUR' },
      { accountId: 'clearing', amount: '-12.50', currency: 'EUR' },
    ])
  })
})

describe('batchSettlementLegs', () => {
  const lines: BatchLine[] = [
    { debtAmount: '10.00', debtCurrency: 'EUR', settled: null },
    { debtAmount: '5.00', debtCurrency: 'EUR', settled: null },
    { debtAmount: '20.00', debtCurrency: 'USD', settled: { amount: '27.40', currency: 'CAD' } },
    { debtAmount: '1000.00', debtCurrency: 'JPY', settled: { amount: '9.10', currency: 'CAD' } },
  ]

  it('pays one cash leg per currency, clears each debt, and bridges converted lines', () => {
    expect(batchSettlementLegs('payer', accounts, lines)).toEqual([
      { accountId: 'cash', amount: '-15.00', currency: 'EUR' },
      { accountId: 'cash', amount: '-36.50', currency: 'CAD' },
      { accountId: 'clearing', amount: '10.00', currency: 'EUR' },
      { accountId: 'clearing', amount: '5.00', currency: 'EUR' },
      { accountId: 'clearing', amount: '20.00', currency: 'USD' },
      { accountId: 'conv', amount: '27.40', currency: 'CAD' },
      { accountId: 'conv', amount: '-20.00', currency: 'USD' },
      { accountId: 'clearing', amount: '1000.00', currency: 'JPY' },
      { accountId: 'conv', amount: '9.10', currency: 'CAD' },
      { accountId: 'conv', amount: '-1000.00', currency: 'JPY' },
    ])
  })

  it('gives the receiver the payer’s legs with every sign flipped', () => {
    const payer = batchSettlementLegs('payer', accounts, lines)
    const receiver = batchSettlementLegs('receiver', accounts, lines)
    expect(receiver.map((l) => ({ ...l, amount: String(-Number(l.amount)) }))).toEqual(
      payer.map((l) => ({ ...l, amount: String(Number(l.amount)) })),
    )
  })

  it('balances per currency on both sides', () => {
    for (const side of ['payer', 'receiver'] as const) {
      expect(imbalance(batchSettlementLegs(side, accounts, lines))).toBeNull()
    }
  })

  it('refuses a converted line with no conversion account', () => {
    expect(() => batchSettlementLegs('payer', { ...accounts, conversion: null }, lines)).toThrow(
      'conversion account',
    )
    // Native lines need none.
    expect(
      imbalance(batchSettlementLegs('payer', { ...accounts, conversion: null }, lines.slice(0, 2))),
    ).toBeNull()
  })
})
