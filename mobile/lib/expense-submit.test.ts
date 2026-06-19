/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_DESCRIPTION,
  ExpenseQueuedError,
  buildExpenseBody,
  canSubmit,
  submitOutcome,
  type ExpenseDraft,
} from './expense-submit'

const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  description: 'Lunch',
  amount: '12.5',
  currency: 'CAD',
  date: '2026-06-19',
  paidByUserId: 'u1',
  paymentAccountId: 'acc1',
  categoryId: null,
  ...over,
})

describe('canSubmit', () => {
  it('allows a positive amount with a payment account', () => {
    expect(canSubmit('12.50', 'acc1')).toBe(true)
  })

  it('blocks a zero amount', () => {
    expect(canSubmit('0', 'acc1')).toBe(false)
    expect(canSubmit('0.00', 'acc1')).toBe(false)
  })

  it('blocks an empty / partial amount', () => {
    expect(canSubmit('', 'acc1')).toBe(false)
    expect(canSubmit('.', 'acc1')).toBe(false)
  })

  it('blocks a missing payment account', () => {
    expect(canSubmit('12.50', null)).toBe(false)
    expect(canSubmit('12.50', '')).toBe(false)
  })

  it('allows a trailing-dot amount that still parses positive', () => {
    expect(canSubmit('12.', 'acc1')).toBe(true)
  })
})

describe('buildExpenseBody', () => {
  it('normalises the amount to 2 decimals', () => {
    expect(buildExpenseBody(draft({ amount: '12.5' })).amount).toBe('12.50')
    expect(buildExpenseBody(draft({ amount: '7' })).amount).toBe('7.00')
    expect(buildExpenseBody(draft({ amount: '12.' })).amount).toBe('12.00')
  })

  it('trims the description', () => {
    expect(buildExpenseBody(draft({ description: '  Coffee  ' })).description).toBe('Coffee')
  })

  it('falls back to the default description when empty', () => {
    expect(buildExpenseBody(draft({ description: '   ' })).description).toBe(DEFAULT_DESCRIPTION)
  })

  it('passes the remaining fields through verbatim', () => {
    const body = buildExpenseBody(
      draft({ currency: 'JPY', date: '2026-01-02', paidByUserId: 'u9', paymentAccountId: 'a9', categoryId: 'c3' }),
    )
    expect(body).toEqual({
      description: 'Lunch',
      amount: '12.50',
      currency: 'JPY',
      date: '2026-01-02',
      paidByUserId: 'u9',
      paymentAccountId: 'a9',
      categoryId: 'c3',
    })
  })
})

describe('submitOutcome', () => {
  it('maps a queued error to "queued"', () => {
    expect(submitOutcome(new ExpenseQueuedError())).toBe('queued')
  })

  it('maps any other error to "error"', () => {
    expect(submitOutcome(new Error('boom'))).toBe('error')
    expect(submitOutcome('nope')).toBe('error')
  })
})
