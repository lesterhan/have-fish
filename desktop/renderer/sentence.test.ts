import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
import { changeOf, destinationOf, paymentsOf, savedValues } from './sentence'

const listed = (fields: Partial<ListedTransaction> = {}): ListedTransaction => ({
  id: 'a',
  date: '2026-10-29',
  description: 'Coffee',
  amounts: [{ amount: '4.50', currency: 'CAD' }],
  simple: { amount: '4.50', currency: 'CAD' },
  from: 'cash',
  to: 'food',
  fromPath: 'assets:cash',
  toPath: 'expenses:food',
  legs: [],
  origin: { source: 'manual', at: 0, here: true, file: null, line: null },
  ...fields,
})

const toOf = (typed: string) => ({ category: typed })
const values = (t = listed()) => savedValues(t)!

describe('a spend as a sentence', () => {
  test('a simple spend starts from what it holds; one that moves more than one amount has none', () => {
    expect(values()).toEqual({
      description: 'Coffee',
      amount: '4.50',
      to: 'food',
      date: '2026-10-29',
    })
    expect(savedValues(listed({ simple: null }))).toBeNull()
  })

  test('a description sends what it was for, and leaves To and the day out', () => {
    expect(changeOf(listed(), values(), 'description', 'Coffee with Sam', toOf)).toEqual({
      id: 'a',
      description: 'Coffee with Sam',
      amount: '4.50',
    })
  })

  test('an amount sends the amount', () => {
    expect(changeOf(listed(), values(), 'amount', '5', toOf)).toMatchObject({ amount: '5' })
  })

  test('To sends only when it moved, as an account when it names one', () => {
    const accounts = (typed: string) =>
      typed === 'visa' ? { account: 'visa-id' } : { category: typed }
    expect(changeOf(listed(), values(), 'to', 'visa', accounts)?.to).toEqual({ account: 'visa-id' })
    // Another part changed: To stays out, so a name a category and an account share can't move it.
    expect(changeOf(listed(), values(), 'amount', '5', accounts)).not.toHaveProperty('to')
  })

  test('the day sends only when it moved, read the short way from today', () => {
    expect(changeOf(listed(), values(), 'date', '2026-10-30', toOf)).toMatchObject({
      date: '2026-10-30',
    })
    expect(changeOf(listed(), values(), 'amount', '5', toOf)).not.toHaveProperty('date')
    // Typed short: today means today.
    expect(changeOf(listed(), values(), 'date', 't', toOf, '2026-10-30')).toMatchObject({
      date: '2026-10-30',
    })
  })

  test('a part left as it was sends nothing', () => {
    expect(changeOf(listed(), values(), 'amount', '4.50', toOf)).toBeNull()
    expect(changeOf(listed(), values(), 'description', 'Coffee', toOf)).toBeNull()
    expect(changeOf(listed(), values(), 'to', ' food ', toOf)).toBeNull()
    expect(changeOf(listed(), values(), 'date', '2026-10-29', toOf)).toBeNull()
    // Yesterday, typed short, is the day it already is.
    expect(changeOf(listed(), values(), 'date', 'y', toOf, '2026-10-30')).toBeNull()
  })
})

describe('a spend paid from more than one account', () => {
  const split = listed({
    simple: null,
    legs: [
      { amount: '-30.00', currency: 'CAD', path: 'assets:cash' },
      { amount: '-20.00', currency: 'CAD', path: 'liabilities:visa' },
      { amount: '50.00', currency: 'CAD', path: 'expenses:food' },
      { amount: '-1.00', currency: 'CAD', path: null },
    ],
  })

  test('each account it came from, with what came out of it, unsigned', () => {
    expect(paymentsOf(split.legs)).toEqual([
      { path: 'assets:cash', money: { amount: '30.00', currency: 'CAD' } },
      { path: 'liabilities:visa', money: { amount: '20.00', currency: 'CAD' } },
    ])
  })

  test('where the money went: the first leg in, with a path', () => {
    expect(destinationOf(split.legs)).toBe('expenses:food')
    expect(destinationOf([{ amount: '5.00', currency: 'CAD', path: null }])).toBeNull()
  })
})
