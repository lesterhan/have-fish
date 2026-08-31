import { describe, it, expect } from 'bun:test'
import {
  buildTopUpPostings,
  canSubmitTopUp,
  currencySums,
  effectiveRate,
  formatRate,
  impliedReceived,
  isCrossCurrency,
  topUpBlocker,
  topUpBlockerMessage,
  type TopUpDraft,
} from './cash-topup'

const sameCurrency: TopUpDraft = {
  sourceAccountId: 'chequing',
  sourceCurrency: 'CAD',
  sourceAmount: '200.00',
  walletAccountId: 'wallet-cad',
  walletCurrency: 'CAD',
  walletAmount: '200.00',
}

const crossCurrency: TopUpDraft = {
  sourceAccountId: 'chequing',
  sourceCurrency: 'CAD',
  sourceAmount: '200.00',
  walletAccountId: 'wallet-cny',
  walletCurrency: 'CNY',
  walletAmount: '1000.00',
  conversionAccountId: 'conversion',
}

describe('isCrossCurrency', () => {
  it('detects a currency change', () => {
    expect(isCrossCurrency({ sourceCurrency: 'CAD', walletCurrency: 'CNY' })).toBe(true)
    expect(isCrossCurrency({ sourceCurrency: 'CAD', walletCurrency: 'CAD' })).toBe(false)
  })

  it('is not cross-currency before a source is chosen', () => {
    expect(isCrossCurrency({ sourceCurrency: '', walletCurrency: 'CNY' })).toBe(false)
  })
})

describe('topUpBlocker', () => {
  it('passes a complete same-currency top-up', () => {
    expect(topUpBlocker(sameCurrency)).toBeNull()
    expect(canSubmitTopUp(sameCurrency)).toBe(true)
  })

  it('passes a complete exchange', () => {
    expect(topUpBlocker(crossCurrency)).toBeNull()
  })

  it('names the next thing to do, in the order the sheet is filled in', () => {
    expect(topUpBlocker({ ...sameCurrency, walletAccountId: null })).toBe('no-wallet')
    expect(topUpBlocker({ ...sameCurrency, sourceAccountId: null })).toBe('no-source')
    expect(topUpBlocker({ ...sameCurrency, sourceAmount: '' })).toBe('no-amount')
  })

  it('needs the received amount only when currencies differ', () => {
    // Same currency implies it; asking twice would just invite a contradiction.
    expect(topUpBlocker({ ...sameCurrency, walletAmount: '' })).toBeNull()
    expect(topUpBlocker({ ...crossCurrency, walletAmount: '' })).toBe('no-received')
  })

  it('refuses an exchange with no conversion account', () => {
    // Nothing can bridge the two currencies without it, and inventing an
    // account would write a transaction the user never agreed to.
    expect(topUpBlocker({ ...crossCurrency, conversionAccountId: null })).toBe(
      'no-conversion-account',
    )
  })

  it('does not require a conversion account for a same-currency top-up', () => {
    expect(topUpBlocker({ ...sameCurrency, conversionAccountId: null })).toBeNull()
  })

  it('refuses a fee at or above the amount', () => {
    expect(topUpBlocker({ ...sameCurrency, feeAmount: '200.00' })).toBe('fee-exceeds-amount')
    expect(topUpBlocker({ ...sameCurrency, feeAmount: '250.00' })).toBe('fee-exceeds-amount')
  })

  it('has copy for every blocker', () => {
    const all = [
      'no-wallet', 'no-source', 'no-amount', 'no-received',
      'no-conversion-account', 'fee-exceeds-amount', 'unbalanced',
    ] as const
    for (const blocker of all) expect(topUpBlockerMessage(blocker).length).toBeGreaterThan(0)
  })
})

describe('impliedReceived', () => {
  it('is the whole amount when there is no fee', () => {
    expect(impliedReceived('200.00')).toBe('200.00')
  })

  it('subtracts the fee', () => {
    expect(impliedReceived('200.00', '3.50')).toBe('196.50')
  })

  it('never goes negative', () => {
    expect(impliedReceived('10.00', '25.00')).toBe('0.00')
  })
})

describe('effectiveRate / formatRate', () => {
  it('reports wallet currency received per unit spent', () => {
    expect(effectiveRate('200.00', '1000.00')).toBe(5)
  })

  it('is all-in — the fee is inside the source amount, so it drags the rate down', () => {
    // A counter quoting 5.0 while skimming a fee is really giving you less;
    // this is the number to check against the board.
    const withFee = effectiveRate('200.00', '985.00')!
    expect(withFee).toBeLessThan(5)
    expect(withFee).toBeCloseTo(4.925, 5)
  })

  it('is null when a side is missing or zero', () => {
    expect(effectiveRate('', '1000.00')).toBeNull()
    expect(effectiveRate('200.00', '')).toBeNull()
    expect(effectiveRate('0.00', '1000.00')).toBeNull()
  })

  it('formats for display', () => {
    expect(formatRate('CAD', 'CNY', 5)).toBe('1 CAD = 5.0000 CNY')
    expect(formatRate('CAD', 'CNY', null)).toBeNull()
  })
})

describe('buildTopUpPostings — same currency', () => {
  it('builds the two-posting withdrawal', () => {
    expect(buildTopUpPostings(sameCurrency)).toEqual([
      { accountId: 'chequing', amount: '-200.00', currency: 'CAD' },
      { accountId: 'wallet-cad', amount: '200.00', currency: 'CAD' },
    ])
  })

  it('books a fee and gives the wallet the remainder', () => {
    const postings = buildTopUpPostings({
      ...sameCurrency,
      feeAccountId: 'fees',
      feeAmount: '3.00',
    })
    expect(postings).toEqual([
      { accountId: 'chequing', amount: '-200.00', currency: 'CAD' },
      { accountId: 'fees', amount: '3.00', currency: 'CAD' },
      { accountId: 'wallet-cad', amount: '197.00', currency: 'CAD' },
    ])
  })

  it('balances to zero', () => {
    expect(currencySums(buildTopUpPostings(sameCurrency))).toEqual({ CAD: 0 })
    expect(
      currencySums(buildTopUpPostings({ ...sameCurrency, feeAccountId: 'fees', feeAmount: '3.00' })),
    ).toEqual({ CAD: 0 })
  })
})

describe('buildTopUpPostings — cross currency', () => {
  it('bridges through the conversion account', () => {
    expect(buildTopUpPostings(crossCurrency)).toEqual([
      { accountId: 'chequing', amount: '-200.00', currency: 'CAD' },
      { accountId: 'conversion', amount: '200.00', currency: 'CAD' },
      { accountId: 'conversion', amount: '-1000.00', currency: 'CNY' },
      { accountId: 'wallet-cny', amount: '1000.00', currency: 'CNY' },
    ])
  })

  it('produces the five-posting shape with a fee', () => {
    // The same structure the Currency Transfers epic established for Wise.
    const postings = buildTopUpPostings({
      ...crossCurrency,
      feeAccountId: 'fees',
      feeAmount: '3.00',
    })
    expect(postings).toEqual([
      { accountId: 'chequing', amount: '-200.00', currency: 'CAD' },
      { accountId: 'fees', amount: '3.00', currency: 'CAD' },
      { accountId: 'conversion', amount: '197.00', currency: 'CAD' },
      { accountId: 'conversion', amount: '-1000.00', currency: 'CNY' },
      { accountId: 'wallet-cny', amount: '1000.00', currency: 'CNY' },
    ])
  })

  it('balances each currency independently — the invariant the backend checks', () => {
    expect(currencySums(buildTopUpPostings(crossCurrency))).toEqual({ CAD: 0, CNY: 0 })
    expect(
      currencySums(
        buildTopUpPostings({ ...crossCurrency, feeAccountId: 'fees', feeAmount: '3.00' }),
      ),
    ).toEqual({ CAD: 0, CNY: 0 })
  })

  it('balances at an awkward rate that floats would drift on', () => {
    const postings = buildTopUpPostings({
      ...crossCurrency,
      sourceAmount: '183.33',
      walletAmount: '941.07',
      feeAccountId: 'fees',
      feeAmount: '0.29',
    })
    expect(currencySums(postings)).toEqual({ CAD: 0, CNY: 0 })
  })

  it('refuses without a conversion account', () => {
    expect(() => buildTopUpPostings({ ...crossCurrency, conversionAccountId: null })).toThrow(
      /conversion account/,
    )
  })
})

describe('buildTopUpPostings — guards', () => {
  it('refuses a fee with nowhere to book it', () => {
    // Dropping the fee silently would unbalance the transaction.
    expect(() => buildTopUpPostings({ ...sameCurrency, feeAmount: '3.00' })).toThrow(
      /account for the fee/,
    )
  })

  it('refuses an incomplete draft rather than sending it', () => {
    expect(() => buildTopUpPostings({ ...sameCurrency, sourceAccountId: null })).toThrow()
    expect(() => buildTopUpPostings({ ...sameCurrency, sourceAmount: '0.00' })).toThrow()
  })

  it('credits the source and debits the wallet', () => {
    const postings = buildTopUpPostings(crossCurrency)
    expect(parseFloat(postings[0].amount)).toBeLessThan(0)
    expect(parseFloat(postings[postings.length - 1].amount)).toBeGreaterThan(0)
  })
})
