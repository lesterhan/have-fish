import { describe, it, expect } from 'bun:test'
import { amountTone } from './amountTone'

describe('amountTone', () => {
  it('leaves an ordinary spend neutral', () => {
    // Card −296.80 against expenses:uncategorized. Every row on a credit card looks like
    // this, which is exactly why it must not be tinted.
    expect(amountTone('-296.80', 'expense')).toBe('neutral')
  })

  it('tints a refund that reverses a spend', () => {
    // Card +412.10 against the expense account the original charge went to.
    expect(amountTone('412.10', 'expense')).toBe('positive')
  })

  it('tints income arriving on the account', () => {
    expect(amountTone('2500.00', 'income')).toBe('positive')
  })

  it('treats zero as neutral, not positive', () => {
    expect(amountTone('0.00', 'expense')).toBe('neutral')
  })

  it('hands a transfer to the flow colours, whatever its sign', () => {
    // The subtle one: paying the card down from Wise is +1500.00 on the card, but money
    // moving between your own accounts is not a gain. It must stay neutral-directional
    // teal rather than turning green alongside genuine income.
    expect(amountTone('1500.00', 'asset')).toBe('transfer')
    expect(amountTone('-1500.00', 'asset')).toBe('transfer')
    expect(amountTone('1500.00', 'liability')).toBe('transfer')
    expect(amountTone('500.00', 'equity')).toBe('transfer')
    expect(amountTone('500.00', 'cash')).toBe('transfer')
    expect(amountTone('500.00', 'conversion')).toBe('transfer')
  })

  it('does not tint the spend leg when you are looking at an expense account', () => {
    // On /account/<expenses:food> the current posting is the positive one, but that is
    // the spend itself arriving — not money coming back. The counterpart is the card.
    expect(amountTone('296.80', 'liability')).toBe('transfer')
  })

  it('falls back to sign alone when the counterpart type is unknown', () => {
    expect(amountTone('412.10', null)).toBe('positive')
    expect(amountTone('-412.10', undefined)).toBe('neutral')
  })

  it('falls back to neutral on an unparseable amount', () => {
    expect(amountTone('', 'expense')).toBe('neutral')
    expect(amountTone('not a number', 'expense')).toBe('neutral')
  })
})
