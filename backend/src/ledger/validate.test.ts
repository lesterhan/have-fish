import { describe, expect, it } from 'bun:test'
import { type PostingDraft, validatePostings } from './validate'

// No database here: the validator is a pure function of the postings, which is the point
// of it. A device checking a document it received runs exactly this.

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

const leg = (amount: string, currency = 'CAD', accountId = A): PostingDraft => ({
  accountId,
  amount,
  currency,
})

describe('validatePostings', () => {
  it('accepts two legs that cancel', () => {
    expect(validatePostings([leg('-10.00'), leg('10.00', 'CAD', B)])).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it('accepts a split across several legs', () => {
    const postings = [leg('-30.00'), leg('10.00', 'CAD', B), leg('20.00', 'CAD', C)]
    expect(validatePostings(postings).ok).toBe(true)
  })

  it('balances each currency on its own, never netting one against another', () => {
    // A conversion: 100 CAD out, 68 EUR in, each balanced through the conversion account.
    const conversion = [
      leg('-100.00', 'CAD', A),
      leg('100.00', 'CAD', C),
      leg('-68.00', 'EUR', C),
      leg('68.00', 'EUR', B),
    ]
    expect(validatePostings(conversion).ok).toBe(true)

    // The same money without the bridge legs: the totals are nonsense across currencies,
    // and each currency on its own is off by its whole amount.
    expect(validatePostings([leg('-100.00', 'CAD'), leg('68.00', 'EUR', B)])).toEqual({
      ok: false,
      failure: { error: 'POSTINGS_DO_NOT_BALANCE', detail: { currency: 'CAD', sum: -100 } },
    })
  })

  it('tolerates float dust below a tenth of a cent', () => {
    // 0.1 + 0.2 - 0.3 is 5.5e-17 in floating point, not zero.
    expect(validatePostings([leg('0.1'), leg('0.2', 'CAD', B), leg('-0.3', 'CAD', C)]).ok).toBe(
      true,
    )
  })

  it('rejects an imbalance of more than a tenth of a cent, with the sum', () => {
    const result = validatePostings([leg('-10.00'), leg('9.99', 'CAD', B)])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.error).toBe('POSTINGS_DO_NOT_BALANCE')
    expect(result.failure.detail).toEqual({ currency: 'CAD', sum: expect.closeTo(-0.01, 6) })
  })

  it('names the first unbalanced currency in the order the postings list them', () => {
    const postings = [leg('5', 'EUR'), leg('-10', 'CAD', B), leg('9', 'CAD', C)]
    expect(validatePostings(postings)).toMatchObject({
      ok: false,
      failure: { detail: { currency: 'EUR' } },
    })
  })

  it('rejects fewer than two postings', () => {
    expect(validatePostings([])).toEqual({ ok: false, failure: { error: 'TOO_FEW_POSTINGS' } })
    expect(validatePostings([leg('0')])).toEqual({
      ok: false,
      failure: { error: 'TOO_FEW_POSTINGS' },
    })
  })

  it('rejects an unsupported currency, naming it', () => {
    expect(validatePostings([leg('-1', 'ZZZ'), leg('1', 'ZZZ', B)])).toEqual({
      ok: false,
      failure: { error: 'UNSUPPORTED_CURRENCY', detail: { currency: 'ZZZ' } },
    })
  })

  it('checks count, then currency, then balance', () => {
    // One leg in an unknown currency that doesn't balance: the count is what's reported.
    expect(validatePostings([leg('5', 'ZZZ')])).toMatchObject({
      failure: { error: 'TOO_FEW_POSTINGS' },
    })
    // Two legs, unknown currency, unbalanced: the currency is what's reported.
    expect(validatePostings([leg('5', 'ZZZ'), leg('1', 'ZZZ', B)])).toMatchObject({
      failure: { error: 'UNSUPPORTED_CURRENCY' },
    })
  })

  describe('in a batch', () => {
    it('carries the index into every failure', () => {
      expect(validatePostings([leg('1')], 3)).toEqual({
        ok: false,
        failure: { error: 'TOO_FEW_POSTINGS', detail: { index: 3 } },
      })
      expect(validatePostings([leg('-1', 'ZZZ'), leg('1', 'ZZZ', B)], 0)).toEqual({
        ok: false,
        failure: { error: 'UNSUPPORTED_CURRENCY', detail: { currency: 'ZZZ', index: 0 } },
      })
    })

    it('reports an unbalanced entry by currency and index, without the sum', () => {
      // The bulk endpoint has never sent `sum`; the move keeps its answer as it was.
      expect(validatePostings([leg('-10'), leg('9', 'CAD', B)], 2)).toEqual({
        ok: false,
        failure: { error: 'POSTINGS_DO_NOT_BALANCE', detail: { currency: 'CAD', index: 2 } },
      })
    })
  })
})
