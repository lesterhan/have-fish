import { describe, expect, test } from 'vitest'
import type { ListedAccount } from '../shared/commands'
import { accountRows, balanceText } from './balances'

const account = (fields: Partial<ListedAccount>): ListedAccount => ({
  id: 'a',
  name: 'cash',
  kind: 'cash',
  currency: null,
  start: null,
  balance: [],
  ...fields,
})

const cad = (amount: string) => ({ amount, currency: 'CAD' })

describe('balanceText', () => {
  test('what I have, the home currency unsaid; below zero when overdrawn', () => {
    expect(balanceText([{ currency: 'CAD', cents: 123456 }], 'assets', 'CAD')).toBe('1,234.56')
    expect(balanceText([{ currency: 'CAD', cents: -5000 }], 'assets', 'CAD')).toBe('−50.00')
  })

  test('what I owe shows above zero, and says owed', () => {
    expect(balanceText([{ currency: 'CAD', cents: -1000 }], 'liabilities', 'CAD')).toBe(
      'owed 10.00',
    )
  })

  test('paid past zero, a card holds money for me: no longer owed', () => {
    expect(balanceText([{ currency: 'CAD', cents: 500 }], 'liabilities', 'CAD')).toBe('5.00')
  })

  test('each currency in turn', () => {
    const totals = [
      { currency: 'CAD', cents: 10000 },
      { currency: 'EUR', cents: 5000 },
    ]
    expect(balanceText(totals, 'assets', 'CAD')).toBe('100.00 · 50.00 EUR')
  })

  test('nothing in it is zero, in the currency it is kept to', () => {
    expect(balanceText([], 'assets', 'USD')).toBe('0.00 USD')
    expect(balanceText([], 'liabilities', 'CAD')).toBe('0.00')
  })
})

describe('accountRows', () => {
  test('each account in the list, as the tree has it, with what it shows', () => {
    const rows = accountRows([
      account({ id: 'v', name: 'visa', kind: 'card', currency: 'CAD', balance: [cad('-30.00')] }),
      account({ id: 'c', name: 'cash', balance: [cad('12.00')] }),
    ])

    expect(rows).toEqual([
      expect.objectContaining({ label: 'cash', depth: 0, balance: '12.00' }),
      expect.objectContaining({ label: 'visa', depth: 0, balance: 'owed 30.00' }),
    ])
    expect(rows.map((r) => r.account?.id)).toEqual(['c', 'v'])
  })

  test('a parent nobody added has no account, and its children’s money', () => {
    const rows = accountRows([
      account({
        id: 'c',
        name: 'wise:cad',
        kind: 'bank',
        currency: 'CAD',
        balance: [cad('100.00')],
      }),
      account({
        id: 'e',
        name: 'wise:eur',
        kind: 'bank',
        currency: 'EUR',
        balance: [{ amount: '50.00', currency: 'EUR' }],
      }),
    ])

    expect(rows.map((r) => [r.label, r.depth, r.account?.id ?? null, r.balance])).toEqual([
      ['wise', 0, null, '100.00 · 50.00 EUR'],
      ['cad', 1, 'c', '100.00'],
      ['eur', 1, 'e', '50.00 EUR'],
    ])
  })

  test('an account at zero shows zero in its own currency, or the home one if it holds any', () => {
    const rows = accountRows([
      account({ id: 'u', name: 'savings', kind: 'bank', currency: 'USD' }),
      account({ id: 'c', name: 'cash' }),
    ])
    expect(rows.map((r) => r.balance)).toEqual(['0.00', '0.00 USD'])
  })
})
