import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../../shared/commands'
import { closed, committing, flashed, opened, putBack, refused, saved, sending } from './chips'

const spend: ListedTransaction = {
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
}
/** ¥4,000 for dinner, which a card kept to CAD was charged 36.20 for. */
const DINNER: ListedTransaction = {
  ...spend,
  description: 'Dinner',
  simple: { amount: '4000.00', currency: 'JPY' },
  charged: { amount: '36.20', currency: 'CAD' },
}
/** 100 CAD from wise:cad that arrived in wise:eur as 80 EUR. */
const EXCHANGE: ListedTransaction = {
  ...spend,
  description: 'Wise',
  shape: 'exchange',
  simple: { amount: '80.00', currency: 'EUR' },
  charged: { amount: '100.00', currency: 'CAD' },
  from: 'wise:cad',
  to: 'wise:eur',
}
const toOf = (typed: string) => ({ category: typed })
const TODAY = '2026-10-30'

describe('the chip editor', () => {
  test('opening a chip: its editor holds what is saved', () => {
    expect(opened(closed, spend, 'description')).toEqual({
      ...closed,
      part: 'description',
      value: 'Coffee',
    })
    expect(opened(closed, spend, 'to').value).toBe('food')
    // A spend that moves more than one amount has no chips to open.
    expect(opened(closed, { ...spend, simple: null }, 'amount')).toEqual(closed)
  })

  test('opening one clears why the last was refused', () => {
    const was = refused(opened(closed, spend, 'amount'), 'Not an amount')
    expect(opened(was, spend, 'description').error).toBeNull()
  })

  test('Enter on what is saved: nothing to send, and the chip closes', () => {
    const editing = opened(closed, spend, 'amount')
    expect(committing(editing, spend, toOf, TODAY)).toEqual({ unchanged: 'amount' })
  })

  test('Enter on a change: what to send, and while it goes, nothing more', () => {
    const editing = { ...opened(closed, spend, 'amount'), value: '5' }
    expect(committing(editing, spend, toOf, TODAY)).toEqual({
      send: { id: 'a', amount: '5', description: 'Coffee' },
    })
    expect(committing(sending(editing), spend, toOf, TODAY)).toBeNull()
    expect(committing(closed, spend, toOf, TODAY)).toBeNull()
  })

  test('saved: the chip closes and flashes, until its flash ends', () => {
    const done = saved(sending({ ...opened(closed, spend, 'amount'), value: '5' }))
    expect(done).toEqual({ ...closed, justSaved: 'amount' })
    expect(flashed(done, 'amount')).toEqual(closed)
    // Another chip's flash ending leaves this one's.
    expect(flashed(done, 'date')).toBe(done)
  })

  test('refused: the chip stays open with what was typed, and says why', () => {
    const editing = sending({ ...opened(closed, spend, 'amount'), value: 'x' })
    expect(refused(editing, 'Not an amount')).toEqual({
      ...closed,
      part: 'amount',
      value: 'x',
      error: 'Not an amount',
    })
  })

  test('Esc: what was typed goes, and the chip closes', () => {
    const editing = refused({ ...opened(closed, spend, 'amount'), value: 'x' }, 'Not an amount')
    expect(putBack(editing)).toEqual(closed)
  })
})

describe('a spend paid in another currency', () => {
  test('opens its amount chip holding the amount and its code', () => {
    expect(opened(closed, DINNER, 'amount')).toMatchObject({ part: 'amount', value: '4000 JPY' })
  })

  test('opens its charged chip holding the figure it was charged', () => {
    expect(opened(closed, DINNER, 'charged')).toMatchObject({ part: 'charged', value: '36.20' })
  })

  test('a spend that converts nothing has no charged chip to open', () => {
    expect(opened(closed, spend, 'charged')).toBe(closed)
  })

  test('Enter on the charge as it was: nothing to send', () => {
    const editing = opened(closed, DINNER, 'charged')
    expect(committing(editing, DINNER, toOf, TODAY)).toEqual({ unchanged: 'charged' })
  })

  test('opens its other chips: To holds its category', () => {
    expect(opened(closed, DINNER, 'to')).toMatchObject({ part: 'to', value: 'food' })
  })
})

describe('an exchange', () => {
  test.each(['amount', 'charged', 'to'] as const)('keeps its %s chip closed', (part) => {
    expect(opened(closed, EXCHANGE, part)).toBe(closed)
  })

  test('opens its description chip', () => {
    expect(opened(closed, EXCHANGE, 'description')).toMatchObject({ part: 'description' })
  })

  test('opens its date chip', () => {
    expect(opened(closed, EXCHANGE, 'date')).toMatchObject({ part: 'date' })
  })
})
