import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
import {
  afterSave,
  afterSaves,
  type Drafts,
  editOf,
  savedValues,
  toSend,
  withEdit,
  withError,
  without,
} from './drafts'

const COFFEE = { description: 'Coffee', amount: '4.50', to: 'unsorted', date: '2026-10-29' }
const none: Drafts = new Map()

const listed = (fields: Partial<ListedTransaction> = {}): ListedTransaction => ({
  id: 'a',
  date: '2026-10-29',
  description: 'Coffee',
  amounts: [{ amount: '4.50', currency: 'CAD' }],
  simple: { amount: '4.50', currency: 'CAD' },
  from: 'cash',
  to: 'unsorted',
  fromPath: 'assets:cash',
  toPath: 'expenses:unsorted',
  ...fields,
})

describe('savedValues', () => {
  test('what the pane starts from: the description, the one amount, where it went, its day', () => {
    expect(savedValues(listed())).toEqual(COFFEE)
  })

  test('none for a transaction with no one amount', () => {
    expect(savedValues(listed({ simple: null }))).toBeNull()
  })
})

describe('withEdit', () => {
  test('the first change makes a draft from the saved values', () => {
    expect(withEdit(none, 'a', COFFEE, 'amount', '5')).toEqual(
      new Map([['a', { ...COFFEE, amount: '5', error: null }]]),
    )
  })

  test('later changes keep the earlier ones', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'amount', '5')
    expect(withEdit(drafts, 'a', COFFEE, 'description', 'Tea').get('a')).toEqual({
      ...COFFEE,
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
      ...COFFEE,
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
    expect(afterSave(drafts, 'a', { ...COFFEE, amount: '5' })).toEqual(none)
  })

  test('a draft changed while the save was on its way stays', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'amount', '55')
    expect(afterSave(drafts, 'a', { ...COFFEE, amount: '5' })).toBe(drafts)
  })
})

describe('where it went', () => {
  test('changed, makes a draft; typed back, the draft goes', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'to', 'food')
    expect(drafts.get('a')?.to).toBe('food')
    expect(withEdit(drafts, 'a', COFFEE, 'to', 'unsorted')).toEqual(none)
  })

  test('nowhere else it can go, for a starting balance', () => {
    expect(savedValues(listed({ to: null }))?.to).toBeNull()
  })
})

describe('its day', () => {
  test('changed, makes a draft; typed back, the draft goes', () => {
    const drafts = withEdit(none, 'a', COFFEE, 'date', '2026-10-27')
    expect(drafts.get('a')?.date).toBe('2026-10-27')
    expect(withEdit(drafts, 'a', COFFEE, 'date', '2026-10-29')).toEqual(none)
  })

  test('sent only when it changed', () => {
    const toOf = (typed: string) => ({ category: typed })
    const moved = { id: 'a', sent: { ...COFFEE, date: '2026-10-27' } }
    expect(editOf(moved, 'unsorted', toOf, '2026-10-29')).toMatchObject({ date: '2026-10-27' })
    expect(editOf(moved, 'unsorted', toOf, '2026-10-27')).not.toHaveProperty('date')
  })
})

describe('editOf', () => {
  const toOf = (typed: string) => (typed === 'visa' ? { account: 'v' } : { category: typed })
  const DAY = COFFEE.date

  test('its day typed the short way goes as the date it means, if that changed', () => {
    const typed = (date: string) => ({ id: 'a', sent: { ...COFFEE, date } })
    expect(editOf(typed('y'), 'unsorted', toOf, DAY, '2026-10-30')).not.toHaveProperty('date')
    expect(editOf(typed('-2'), 'unsorted', toOf, DAY, '2026-10-30')).toMatchObject({
      date: '2026-10-28',
    })
    expect(editOf(typed('soon'), 'unsorted', toOf, DAY, '2026-10-30')).toMatchObject({
      date: 'soon',
    })
  })

  test('sends where it goes when that changed, as To resolves it', () => {
    expect(editOf({ id: 'a', sent: { ...COFFEE, to: 'food' } }, 'unsorted', toOf, DAY)).toEqual({
      id: 'a',
      description: 'Coffee',
      amount: '4.50',
      to: { category: 'food' },
    })
    expect(
      editOf({ id: 'a', sent: { ...COFFEE, to: 'visa' } }, 'unsorted', toOf, DAY),
    ).toMatchObject({
      to: { account: 'v' },
    })
  })

  test('leaves it out when it didn’t change, or can’t', () => {
    const left = { id: 'a', description: 'Coffee', amount: '4.50' }
    expect(editOf({ id: 'a', sent: { ...COFFEE, to: 'visa' } }, 'visa', toOf, DAY)).toEqual(left)
    expect(editOf({ id: 'a', sent: { ...COFFEE, to: null } }, null, toOf, DAY)).toEqual(left)
  })
})

describe('toSend', () => {
  const two = withEdit(withEdit(none, 'a', COFFEE, 'amount', '5'), 'b', COFFEE, 'amount', '6')

  test("each draft's values, by id, without its error", () => {
    const refused = withError(two, 'b', { field: 'amount', words: 'No.' })
    expect(toSend(refused, ['a', 'b'])).toEqual([
      { id: 'a', sent: { ...COFFEE, amount: '5' } },
      { id: 'b', sent: { ...COFFEE, amount: '6' } },
    ])
  })

  test('only the ids asked for, and only those with a draft', () => {
    expect(toSend(two, ['b', 'c'])).toEqual([{ id: 'b', sent: { ...COFFEE, amount: '6' } }])
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
