import { describe, expect, test } from 'vitest'
import type { ListedAccount } from '../shared/commands'
import { accountGroups, accountRows, type Balance, balanceOf } from './balances'
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

describe('accounts under their roots', () => {
  const home = [
    account({ id: 'l', name: 'car-loan', kind: 'loan', balance: [cad('-9390.00')] }),
    account({ id: 'c', name: 'tangerine:chequing', kind: 'bank', balance: [cad('3145.28')] }),
    account({ id: 's', name: 'tangerine:savings', kind: 'bank', balance: [cad('9000.00')] }),
    account({ id: 'v', name: 'visa', kind: 'card', balance: [cad('-1218.00')] }),
    account({ id: 'w', name: 'wallet', kind: 'cash', balance: [cad('131.37')] }),
  ]

  test('what I have comes first, then what I owe, each account under its parent', () => {
    expect(accountRows(home).map((r) => [r.root, r.label, r.depth])).toEqual([
      ['assets', 'tangerine', 0],
      ['assets', 'chequing', 1],
      ['assets', 'savings', 1],
      ['assets', 'wallet', 0],
      ['liabilities', 'car-loan', 0],
      ['liabilities', 'visa', 0],
    ])
  })

  test('each root is a group, with how many rows it has and what it comes to', () => {
    const groups = accountGroups(accountRows(home))
    expect(groups.map((g) => [g.root, g.count, said(g.total)])).toEqual([
      ['assets', 4, '12,276.65'],
      ['liabilities', 2, 'owed 10,608.00'],
    ])
  })

  test('a root in more than one currency says each; none is no groups', () => {
    const groups = accountGroups(
      accountRows([
        account({ id: 'c', name: 'cash', balance: [cad('10.00')] }),
        account({ id: 'e', name: 'euros', balance: [{ amount: '5.00', currency: 'EUR' }] }),
      ]),
    )
    expect(groups.map((g) => said(g.total))).toEqual(['10.00 · 5.00 EUR'])
    expect(accountGroups([])).toEqual([])
  })
})
