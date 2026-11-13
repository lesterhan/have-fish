import { describe, expect, test } from 'vitest'
import { type CursorState, cursorFor } from './cursor'

const state = (fields: Partial<CursorState> = {}): CursorState => ({
  total: 3,
  composing: false,
  hidden: false,
  cardWasOpen: false,
  ...fields,
})

describe('where the cursor goes in the ledger', () => {
  test('a fresh ledger loads: the line, to write the first spend', () => {
    expect(cursorFor('loaded', state({ total: 0 }))).toBe('line')
  })

  test('a ledger with spends loads: the list', () => {
    expect(cursorFor('loaded', state())).toBe('list')
  })

  test('loaded while another place shows: left where it is', () => {
    expect(cursorFor('loaded', state({ hidden: true }))).toBeNull()
  })

  test('loaded with the line already open, as the first run opens it: the line', () => {
    expect(cursorFor('loaded', state({ total: 0, composing: true }))).toBe('line')
    expect(cursorFor('loaded', state({ composing: true }))).toBe('line')
  })

  test('coming here from another place: the line if it is open, else the list, else a new line', () => {
    expect(cursorFor('cameHere', state({ composing: true }))).toBe('line')
    expect(cursorFor('cameHere', state())).toBe('list')
    expect(cursorFor('cameHere', state({ total: 0 }))).toBe('line')
  })

  test('a new spend, or a card opened: there', () => {
    expect(cursorFor('newSpend', state())).toBe('line')
    expect(cursorFor('cardOpened', state())).toBe('card')
  })

  test('a spend written: the fresh line, which stays open; the list once it has closed', () => {
    expect(cursorFor('written', state({ composing: true }))).toBe('line')
    expect(cursorFor('written', state())).toBe('list')
  })

  test('the line closed: the list, if there is one', () => {
    expect(cursorFor('lineClosed', state())).toBe('list')
    expect(cursorFor('lineClosed', state({ total: 0 }))).toBeNull()
  })

  test('the last spend removed: the line; one removed from its card: the list', () => {
    expect(cursorFor('removed', state({ total: 0 }))).toBe('line')
    expect(cursorFor('removed', state({ cardWasOpen: true }))).toBe('list')
    // Removed with Delete on the list: the list still has it.
    expect(cursorFor('removed', state())).toBeNull()
  })

  test('a card closed: the list', () => {
    expect(cursorFor('cardClosed', state())).toBe('list')
  })
})
