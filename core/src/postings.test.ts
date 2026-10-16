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
    expect(validatePostings(postings)).toEqual({
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

  it('zero amount is accepted', () => {
    const postings = [leg('0.00', CAD, A), leg('-0.00', CAD, B)]
    expect(validatePostings(postings)).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it('max amount is accepted', () => {
    const postings = [leg('9999999999.99', CAD, A), leg('-9999999999.99', CAD, B)]
    expect(validatePostings(postings)).toEqual({
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
    const postings = [leg('15.50', 'EUR', A), leg('-10.00', CAD, B)]
    expect(validatePostings(postings)).toEqual({
      ok: false,
      failure: {
        code: 'POSTINGS_DO_NOT_BALANCE',
        details: {
          currency: EUR,
          cents: 1550,
        },
      },
    })
  })

  it('balanced currencies postings accepted', () => {
    const postings = [
      leg('15.50', CAD, A),
      leg('-15.50', CAD, B),
      leg('8.89', 'EUR', B),
      leg('-8.89', 'EUR', C),
    ]
    expect(validatePostings(postings)).toEqual({
      ok: true,
      value: undefined,
    })
  })
})
