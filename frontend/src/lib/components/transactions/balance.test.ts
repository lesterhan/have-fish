import { describe, expect, it } from 'bun:test'
import { balancesInCents, isBalanced } from './balance'

const leg = (amount: string, currency = 'CAD') => ({ amount, currency })

describe('balancesInCents', () => {
  it('sums each currency in cents, never netting one against another', () => {
    const sums = balancesInCents([leg('10.00'), leg('-9.99'), leg('5', 'EUR'), leg('-5', 'EUR')])
    expect([...sums]).toEqual([
      ['CAD', 1],
      ['EUR', 0],
    ])
  })

  it('adds without float drift', () => {
    expect(balancesInCents([leg('0.10'), leg('0.20'), leg('-0.30')]).get('CAD')).toBe(0)
  })

  it('leaves out an amount that cannot be read yet', () => {
    expect([...balancesInCents([leg(''), leg('-'), leg('12.00'), leg('-12')])]).toEqual([
      ['CAD', 0],
    ])
  })
})

describe('isBalanced', () => {
  it('is true only when every currency is exactly zero', () => {
    expect(isBalanced(balancesInCents([leg('10.00'), leg('-10.00')]))).toBe(true)
    expect(isBalanced(balancesInCents([leg('10.00'), leg('-9.99')]))).toBe(false)
  })

  // The case the server refused and the old check let through: 0.005 is stored as 0.01 and
  // -0.004 as 0.00, so the legs don't balance once written.
  it('rounds each leg as the column stores it, as the server does', () => {
    expect(isBalanced(balancesInCents([leg('0.005'), leg('-0.004')]))).toBe(false)
    expect(isBalanced(balancesInCents([leg('0.005'), leg('-0.01')]))).toBe(true)
  })
})
