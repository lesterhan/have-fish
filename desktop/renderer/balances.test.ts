import { describe, expect, test } from 'vitest'
import type { ListedAccount } from '../shared/commands'
import { accountRows, type Balance, balanceOf } from './balances'
import { money } from './format'

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

/** A balance as the list reads it out. */
const said = (balance: Balance[]) =>
  balance
    .map((b) => `${b.owed ? 'owed ' : ''}${money(b.money.amount, b.money.currency)}`)
    .join(' · ')

describe('balanceOf', () => {
  test('what I have, as it is; below zero when overdrawn', () => {
    expect(balanceOf([{ currency: 'CAD', cents: 123456 }], 'assets', 'CAD')).toEqual([
      { money: cad('1234.56'), owed: false },
    ])
    expect(balanceOf([{ currency: 'CAD', cents: -5000 }], 'assets', 'CAD')).toEqual([
      { money: cad('-50.00'), owed: false },
    ])
  })

  test('what I owe shows above zero, and says owed', () => {
    expect(balanceOf([{ currency: 'CAD', cents: -1000 }], 'liabilities', 'CAD')).toEqual([
      { money: cad('10.00'), owed: true },
    ])
  })

  test('paid past zero, a card holds money for me: no longer owed', () => {
    expect(balanceOf([{ currency: 'CAD', cents: 500 }], 'liabilities', 'CAD')).toEqual([
      { money: cad('5.00'), owed: false },
    ])
  })

  test('each currency in turn', () => {
    const totals = [
      { currency: 'CAD', cents: 10000 },
      { currency: 'EUR', cents: 5000 },
    ]
    expect(balanceOf(totals, 'assets', 'CAD')).toEqual([
      { money: cad('100.00'), owed: false },
      { money: { amount: '50.00', currency: 'EUR' }, owed: false },
    ])
  })

  test('nothing in it is zero, in the currency it is kept to', () => {
    expect(balanceOf([], 'assets', 'USD')).toEqual([
      { money: { amount: '0.00', currency: 'USD' }, owed: false },
    ])
  })
})

describe('accountRows', () => {
  test('each account in the list, as the tree has it, with what it shows', () => {
    const rows = accountRows([
      account({ id: 'v', name: 'visa', kind: 'card', currency: 'CAD', balance: [cad('-30.00')] }),
      account({ id: 'c', name: 'cash', balance: [cad('12.00')] }),
    ])

    expect(rows.map((r) => [r.label, r.depth, said(r.balance)])).toEqual([
      ['cash', 0, '12.00'],
      ['visa', 0, 'owed 30.00'],
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

    expect(rows.map((r) => [r.label, r.depth, r.account?.id ?? null, said(r.balance)])).toEqual([
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
    expect(rows.map((r) => said(r.balance))).toEqual(['0.00', '0.00 USD'])
  })
})
