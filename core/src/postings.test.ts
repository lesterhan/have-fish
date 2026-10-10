import { describe, expect, it } from 'vitest'
import { type PostingDraft, validatePostings } from './postings'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

const CAD = 'CAD'

const leg = (amount: string, currency = CAD, accountId = A): PostingDraft => ({
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
})
