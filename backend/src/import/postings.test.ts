import { describe, expect, it } from 'bun:test'
import { buildCrossCurrencySpendPostings, buildRegularPostings, inCents } from './postings'

// Pure-function tests for the cross-currency SPEND builder — the canonical Wise example:
// coffee bought for 360 CZK while holding no CZK, funded from USD (17.29 USD gross,
// 0.05 USD fee, 17.24 USD net converted).
describe('buildCrossCurrencySpendPostings', () => {
  const base = {
    transactionId: 'tx1',
    sourceAccountId: 'usd',
    sourceAmount: '-17.29',
    sourceCurrency: 'USD',
    conversionAccountId: 'equity',
    conversionSrcAmount: '17.24', // = −(−17.29 + 0.05)
    targetAmount: '360.00',
    targetCurrency: 'CZK',
    expenseAccountId: 'coffee',
  }

  const sumBy = (specs: { amount: string; currency: string }[], currency: string) =>
    specs.filter((p) => p.currency === currency).reduce((a, p) => a + parseFloat(p.amount), 0)

  it('with fee: 5 postings, both currencies balance to zero', () => {
    const specs = buildCrossCurrencySpendPostings({
      ...base,
      feeAmount: '0.05',
      feeCurrency: 'USD',
      feeAccountId: 'fee',
    })

    expect(specs).toHaveLength(5)
    expect(Math.abs(sumBy(specs, 'USD'))).toBeLessThan(0.001)
    expect(Math.abs(sumBy(specs, 'CZK'))).toBeLessThan(0.001)
  })

  it('without fee: 4 postings, both currencies balance to zero', () => {
    // No fee → the full source outflow is the converted net, so they must match.
    const specs = buildCrossCurrencySpendPostings({ ...base, sourceAmount: '-17.24' })

    expect(specs).toHaveLength(4)
    expect(Math.abs(sumBy(specs, 'USD'))).toBeLessThan(0.001)
    expect(Math.abs(sumBy(specs, 'CZK'))).toBeLessThan(0.001)
  })

  it('bridges both currency sides through equity:conversions, never the expense account', () => {
    const specs = buildCrossCurrencySpendPostings({
      ...base,
      feeAmount: '0.05',
      feeAccountId: 'fee',
    })

    // The conversion account carries the bridge on BOTH sides
    expect(specs).toContainEqual(
      expect.objectContaining({ accountId: 'equity', amount: '17.24', currency: 'USD' }),
    )
    expect(specs).toContainEqual(
      expect.objectContaining({ accountId: 'equity', amount: '-360.00', currency: 'CZK' }),
    )

    // The expense account appears exactly once, in the target currency, as the spend —
    // never as a bridge leg in the source currency (that was the bug).
    const expenseLegs = specs.filter((p) => p.accountId === 'coffee')
    expect(expenseLegs).toHaveLength(1)
    expect(expenseLegs[0]).toEqual(expect.objectContaining({ amount: '360.00', currency: 'CZK' }))
    expect(specs.some((p) => p.accountId === 'coffee' && p.currency === 'USD')).toBe(false)
  })

  it('produces no phantom asset leg — the only asset posting is the funding outflow', () => {
    const specs = buildCrossCurrencySpendPostings(base)
    const sourceLegs = specs.filter((p) => p.accountId === 'usd')
    expect(sourceLegs).toHaveLength(1)
    expect(sourceLegs[0]).toEqual(expect.objectContaining({ amount: '-17.29', currency: 'USD' }))
    // No leg credits a target-currency *asset* — the target money is consumed by the spend.
    expect(
      specs.some(
        (p) => p.currency === 'CZK' && parseFloat(p.amount) > 0 && p.accountId !== 'coffee',
      ),
    ).toBe(false)
  })
})

describe('inCents', () => {
  it('does the arithmetic in whole cents', () => {
    expect(inCents(['0.10', '0.20'], (a, b) => a + b)).toBe('0.30')
    expect(inCents(['-17.29', '0.05'], (s, f) => -(s + f))).toBe('17.24')
  })

  it('writes the result as the two-place string a posting stores', () => {
    expect(inCents(['360'], (t) => t)).toBe('360.00')
    expect(inCents(['-5.5'], Math.abs)).toBe('5.50')
  })

  it('never writes a negative zero', () => {
    expect(inCents(['0.00'], (a) => -a)).toBe('0.00')
  })

  // Commit doesn't check its amounts before planning (#434); the ledger check refuses them.
  it("answers 'NaN' for an amount that isn't one, rather than throwing", () => {
    expect(inCents(['abc'], (a) => -a)).toBe('NaN')
    expect(inCents(['1.00', undefined], (a, b) => a + b)).toBe('NaN')
    expect(inCents(['1,000.00'], (a) => a)).toBe('NaN')
  })
})

describe('buildRegularPostings', () => {
  it('offsets the amount exactly', () => {
    const legs = buildRegularPostings({
      transactionId: 'tx',
      sourceAccountId: 'src',
      amount: '-1234567.89',
      offsetAccountId: 'food',
      currency: 'CAD',
    })
    expect(legs.map((l) => l.amount)).toEqual(['-1234567.89', '1234567.89'])
  })
})
