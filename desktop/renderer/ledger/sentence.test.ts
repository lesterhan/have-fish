import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../../shared/commands'
import { changeOf, destinationOf, paymentsOf, savedValues } from './sentence'

const listed = (fields: Partial<ListedTransaction> = {}): ListedTransaction => ({
  id: 'a',
  date: '2026-10-29',
  description: 'Coffee',
  shape: 'spend',
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

const YEN_SPEND = listed({
  amounts: [{ amount: '1500.00', currency: 'JPY' }],
  simple: { amount: '1500.00', currency: 'JPY' },
  description: 'Ramen',
})

describe('a spend as a sentence', () => {
  test('a simple spend starts from what it holds; one that moves more than one amount has none', () => {
    expect(values()).toEqual({
      description: 'Coffee',
      amount: '4.50',
      charged: null,
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

describe('a spend in another currency', () => {
  test('its amount starts as typed, with its code', () => {
    expect(values(YEN_SPEND).amount).toBe('1500 JPY')
  })

  test('a code typed after the amount is sent apart from it', () => {
    expect(changeOf(listed(), values(), 'amount', '1500 jpy', toOf)).toStrictEqual({
      id: 'a',
      amount: '1500',
      description: 'Coffee',
      currency: 'JPY',
    })
  })

  test('an amount with its code deleted is in the home currency', () => {
    expect(changeOf(YEN_SPEND, values(YEN_SPEND), 'amount', '1500', toOf)).toMatchObject({
      amount: '1500',
      currency: 'CAD',
    })
  })

  test('the code it is already in is not sent', () => {
    const change = changeOf(YEN_SPEND, values(YEN_SPEND), 'amount', '2000 JPY', toOf)
    expect(change).toMatchObject({ amount: '2000' })
    expect(change).not.toHaveProperty('currency')
  })

  test('another part sends the amount without its code, and the currency stays', () => {
    expect(
      changeOf(YEN_SPEND, values(YEN_SPEND), 'description', 'Ramen, large', toOf),
    ).toStrictEqual({ id: 'a', amount: '1500', description: 'Ramen, large' })
  })

  test('its amount left as it was, code and all, sends nothing', () => {
    expect(changeOf(YEN_SPEND, values(YEN_SPEND), 'amount', '1500 JPY', toOf)).toBeNull()
  })
})

describe('a spend paid in another currency', () => {
  /** ¥4,000 for dinner, which a card kept to CAD was charged 36.20 for. */
  const DINNER = listed({
    description: 'Dinner',
    shape: 'converted',
    amounts: [{ amount: '4000.00', currency: 'JPY' }],
    simple: { amount: '4000.00', currency: 'JPY' },
    charged: { amount: '36.20', currency: 'CAD' },
  })

  test('its charge starts as the figure it was charged, without its code', () => {
    expect(values(DINNER).charged).toBe('36.20')
  })

  test('a charge in another currency than home starts without its code too', () => {
    const usd = listed({ ...DINNER, charged: { amount: '27.00', currency: 'USD' } })
    expect(values(usd).charged).toBe('27.00')
  })

  test('a spend that converts nothing has no charge', () => {
    expect(values().charged).toBeNull()
  })

  test('a new charge sends the charge as typed, with the amount and no code', () => {
    expect(changeOf(DINNER, values(DINNER), 'charged', '38.10', toOf)).toStrictEqual({
      id: 'a',
      amount: '4000',
      description: 'Dinner',
      charged: '38.10',
    })
  })

  test('a new amount in its own currency sends no charge and no code', () => {
    expect(changeOf(DINNER, values(DINNER), 'amount', '4500 jpy', toOf)).toStrictEqual({
      id: 'a',
      amount: '4500',
      description: 'Dinner',
    })
  })

  test('a new amount with no code sends the home currency and no charge', () => {
    expect(changeOf(DINNER, values(DINNER), 'amount', '40', toOf)).toStrictEqual({
      id: 'a',
      amount: '40',
      description: 'Dinner',
      currency: 'CAD',
    })
  })

  test('a new description sends no charge', () => {
    expect(
      changeOf(DINNER, values(DINNER), 'description', 'Dinner, Shinjuku', toOf),
    ).not.toHaveProperty('charged')
  })
})

describe('a spend waiting for its charge', () => {
  /** ¥8,400 for lunch, from a card kept to CAD, waiting for what the bank posts. */
  const WAITING = listed({
    description: 'Lunch',
    shape: 'awaiting',
    amounts: [{ amount: '8400.00', currency: 'JPY' }],
    simple: { amount: '8400.00', currency: 'JPY' },
    charged: { amount: '0.00', currency: 'CAD' },
  })

  test('its charge starts empty, not at the zero the ledger holds', () => {
    expect(values(WAITING).charged).toBe('')
  })

  test('Enter on its empty charge sends nothing', () => {
    expect(changeOf(WAITING, values(WAITING), 'charged', '', toOf)).toBeNull()
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
