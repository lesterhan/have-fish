import { describe, expect, it } from 'vitest'
import type { Currency } from './currencies'
import { type PostingDraft, validatePostings } from './postings'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const CAD: Currency = 'CAD'
const EUR: Currency = 'EUR'

const leg = (amount: string, currency = 'CAD', accountId = A): PostingDraft => ({
  accountId,
  amount,
  currency,
})

describe('validatePostings', () => {
  it('2 legs that sum to zero is valid', () => {
    const postings = [leg('-9.99', CAD, A), leg('9.99', CAD, B)]
    expect(validatePostings(postings)).toStrictEqual({
      ok: true,
      value: undefined,
    })
  })

  it('only 1 leg returns TOO_FEW_POSTINGS', () => {
    expect(validatePostings([])).toEqual({
      ok: false,
      failure: {
        code: 'TOO_FEW_POSTINGS',
        details: undefined,
      },
    })
    expect(validatePostings([leg('9.99')])).toEqual({
      ok: false,
      failure: {
        code: 'TOO_FEW_POSTINGS',
        details: undefined,
      },
    })
  })

  it('unsupported currency returns UNSUPPORTED_CURRENCY', () => {
    const postings = [leg('9.99', 'ZZZ', A), leg('-9.99', 'ZZZ', B)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      failure: {
        code: 'UNSUPPORTED_CURRENCY',
        details: { currency: 'ZZZ' },
      },
    })
  })

  it('small case currency is unsupported', () => {
    const postings = [leg('9.99', 'cad', A), leg('-9.99', 'cad', B)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      failure: {
        code: 'UNSUPPORTED_CURRENCY',
        details: { currency: 'cad' },
      },
    })
  })

  it('zero amount is accepted', () => {
    const postings = [leg('0.00', CAD, A), leg('-0.00', CAD, B)]
    expect(validatePostings(postings)).toStrictEqual({
      ok: true,
      value: undefined,
    })
  })

  it('max amount is accepted', () => {
    const postings = [leg('9999999999.99', CAD, A), leg('-9999999999.99', CAD, B)]
    expect(validatePostings(postings)).toStrictEqual({
      ok: true,
      value: undefined,
    })
  })

  it.each(['abc', 'NaN', '10000000000', '1,999.00', ''])('refuse %s as amount', (amt) => {
    const postings = [leg('9.99', CAD, A), leg(amt, CAD, B)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      failure: {
        code: 'AMOUNT_INVALID',
        details: { amount: amt },
      },
    })
  })

  it('imbalanced same currency postings refused', () => {
    const postings = [leg('15.50', CAD, A), leg('-10.00', CAD, B)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      failure: {
        code: 'POSTINGS_DO_NOT_BALANCE',
        details: {
          currency: CAD,
          cents: 550,
        },
      },
    })
  })

  it('imbalanced different currency postings refused', () => {
    const postings = [leg('10.00', EUR, A), leg('-10.00', CAD, B)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      failure: {
        code: 'POSTINGS_DO_NOT_BALANCE',
        details: {
          currency: EUR,
          cents: 1000,
        },
      },
    })
  })

  it('imbalanced different currency postings always report first failed currency', () => {
    const postings = [leg('10.00', EUR, A), leg('-10.00', CAD, B), leg('9.00', CAD, C)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      failure: {
        code: 'POSTINGS_DO_NOT_BALANCE',
        details: {
          currency: EUR,
          cents: 1000,
        },
      },
    })
  })

  it('each leg is rounded before summing', () => {
    // 0.005 rounds to 1 cent, -0.004 rounds to 0 cents
    const imbalancedPostings = [leg('0.005', CAD, A), leg('-0.004', CAD, B)]
    expect(validatePostings(imbalancedPostings)).toEqual({
      ok: false,
      failure: {
        code: 'POSTINGS_DO_NOT_BALANCE',
        details: {
          currency: CAD,
          cents: 1,
        },
      },
    })
    // -0.999 rounds to 1.00
    const balancedPostings = [leg('1.00', CAD, A), leg('-0.999', CAD, B)]
    expect(validatePostings(balancedPostings)).toStrictEqual({
      ok: true,
      value: undefined,
    })
  })

  it('2+ legs also balance', () => {
    const postings = [leg('-5.50', CAD, A), leg('-1.50', CAD, B), leg('7.00', CAD, C)]
    expect(validatePostings(postings)).toStrictEqual({
      ok: true,
      value: undefined,
    })
  })

  it('balanced currencies postings accepted', () => {
    const postings = [
      leg('15.50', CAD, A),
      leg('-15.50', CAD, B),
      leg('8.89', EUR, B),
      leg('-8.89', EUR, C),
    ]
    expect(validatePostings(postings)).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it('rule check order is respected', () => {
    const postings = [leg('raptors', CAD, A), leg('10.00', 'ZZZ', B)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      // currency check comes before amount check
      failure: {
        code: 'UNSUPPORTED_CURRENCY',
        details: {
          currency: 'ZZZ',
        },
      },
    })
    const tooFewPostings = [leg('10.00', 'ZZZ', A)]
    expect(validatePostings(tooFewPostings)).toEqual({
      ok: false,
      // posting count check comes before currency check
      failure: {
        code: 'TOO_FEW_POSTINGS',
        details: undefined,
      },
    })
  })
})
