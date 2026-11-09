import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
import { type Changable, changeOf, savedValues } from './sentence'

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
    expect(changeOf(listed(), values(), 'to', 'visa', accounts).to).toEqual({ account: 'visa-id' })
    expect(changeOf(listed(), values(), 'to', 'food', accounts)).not.toHaveProperty('to')
  })

  test('the day sends only when it moved, read the short way from today', () => {
    expect(changeOf(listed(), values(), 'date', '2026-10-30', toOf)).toMatchObject({
      date: '2026-10-30',
    })
    expect(changeOf(listed(), values(), 'date', '2026-10-29', toOf)).not.toHaveProperty('date')
    // Typed short: today means today, and yesterday is where it already is.
    expect(changeOf(listed(), values(), 'date', 't', toOf, '2026-10-30')).toMatchObject({
      date: '2026-10-30',
    })
    expect(changeOf(listed(), values(), 'date', 'y', toOf, '2026-10-30')).not.toHaveProperty('date')
  })

  test('a part that sends nothing but its own value still sends the amount and description', () => {
    const parts: Changable[] = ['amount', 'description', 'date', 'to']
    for (const part of parts) {
      const input = changeOf(listed(), values(), part, values()[part] ?? '', toOf)
      expect(input).toMatchObject({ id: 'a', description: 'Coffee', amount: '4.50' })
    }
  })
})
