import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
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
