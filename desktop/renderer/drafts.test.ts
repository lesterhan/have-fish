import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
import {
  afterSave,
  afterSaves,
  type Drafts,
  savedValues,
  toSend,
  withEdit,
  withError,
  without,
} from './drafts'

const COFFEE = { description: 'Coffee', amount: '4.50' }
const none: Drafts = new Map()

const listed = (fields: Partial<ListedTransaction> = {}): ListedTransaction => ({
  id: 'a',
  date: '2026-10-29',
  description: 'Coffee',
  amounts: [{ amount: '4.50', currency: 'CAD' }],
  simple: { amount: '4.50', currency: 'CAD' },
  from: 'cash',
  ...fields,
})

describe('savedValues', () => {
  test('what the pane starts from: the description and the one amount', () => {
    expect(savedValues(listed())).toEqual(COFFEE)
  })

  test('none for a transaction with no one amount', () => {
    expect(savedValues(listed({ simple: null }))).toBeNull()
  })
})

describe('withEdit', () => {
  test('the first change makes a draft from the saved values', () => {
    expect(withEdit(none, 'a', COFFEE, 'amount', '5')).toEqual(
      new Map([['a', { description: 'Coffee', amount: '5', error: null }]]),
    )
  })

  test('later changes keep the earlier ones', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'amount', '5')
    expect(withEdit(drafts, 'a', COFFEE, 'description', 'Tea').get('a')).toEqual({
      description: 'Tea',
      amount: '5',
      error: null,
    })
  })

  test('typing back to what is saved drops the draft', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'amount', '4.5')
    expect(withEdit(drafts, 'a', COFFEE, 'amount', '4.50')).toEqual(none)
  })

  test("leaves other spends' drafts alone, and the map it was given", () => {
    const drafts = withEdit(none, 'b', COFFEE, 'amount', '1')
    const next = withEdit(drafts, 'a', COFFEE, 'amount', '5')
    expect([...next.keys()]).toEqual(['b', 'a'])
    expect([...drafts.keys()]).toEqual(['b'])
  })

  test('a refusal stays with the draft while it is edited', () => {
    const refused = withError(withEdit(none, 'a', COFFEE, 'amount', 'abc'), 'a', {
      field: 'amount',
      words: 'No',
    })
    expect(withEdit(refused, 'a', COFFEE, 'amount', 'abcd').get('a')?.error).toEqual({
      field: 'amount',
      words: 'No',
    })
  })
})

describe('withError', () => {
  test('marks the draft with why its save was refused', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'amount', 'abc')
    expect(withError(drafts, 'a', { field: 'amount', words: 'No' }).get('a')).toEqual({
      description: 'Coffee',
      amount: 'abc',
      error: { field: 'amount', words: 'No' },
    })
  })

  test('no draft, nothing to mark', () => {
    expect(withError(none, 'a', { field: 'form', words: 'No' })).toEqual(none)
  })
})

describe('without', () => {
  test('drops one draft', () => {
    const drafts = withEdit(withEdit(none, 'a', COFFEE, 'amount', '5'), 'b', COFFEE, 'amount', '6')
    expect([...without(drafts, 'a').keys()]).toEqual(['b'])
  })
})

describe('afterSave', () => {
  test('the saved draft goes', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'amount', '5')
    expect(afterSave(drafts, 'a', { description: 'Coffee', amount: '5' })).toEqual(none)
  })

  test('a draft changed while the save was on its way stays', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'amount', '55')
    expect(afterSave(drafts, 'a', { description: 'Coffee', amount: '5' })).toBe(drafts)
  })
})

describe('toSend', () => {
  const two = withEdit(withEdit(none, 'a', COFFEE, 'amount', '5'), 'b', COFFEE, 'amount', '6')

  test("each draft's values, by id, without its error", () => {
    const refused = withError(two, 'b', { field: 'amount', words: 'No.' })
    expect(toSend(refused, ['a', 'b'])).toEqual([
      { id: 'a', sent: { description: 'Coffee', amount: '5' } },
      { id: 'b', sent: { description: 'Coffee', amount: '6' } },
    ])
  })

  test('only the ids asked for, and only those with a draft', () => {
    expect(toSend(two, ['b', 'c'])).toEqual([
      { id: 'b', sent: { description: 'Coffee', amount: '6' } },
    ])
  })
})

describe('afterSaves', () => {
  const two = withEdit(withEdit(none, 'a', COFFEE, 'amount', '5'), 'b', COFFEE, 'amount', 'x')
  const WHY = { field: 'amount' as const, words: "That isn't an amount." }

  test('each saved draft goes, and each refused one stays and says why', () => {
    const after = afterSaves(two, [
      { id: 'a', sent: { ...COFFEE, amount: '5' }, error: null },
      { id: 'b', sent: { ...COFFEE, amount: 'x' }, error: WHY },
    ])
    expect([...after]).toEqual([['b', { ...COFFEE, amount: 'x', error: WHY }]])
  })

  test('a draft typed into while it was being saved stays', () => {
    const typed = withEdit(two, 'a', COFFEE, 'amount', '55')
    const after = afterSaves(typed, [{ id: 'a', sent: { ...COFFEE, amount: '5' }, error: null }])
    expect(after.get('a')?.amount).toBe('55')
  })
})
