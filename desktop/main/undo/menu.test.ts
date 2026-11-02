import { describe, expect, test } from 'vitest'
import { History } from './history'
import { typingFrom, undoItems } from './menu'
import type { Step } from './steps'

const NONE = { undo: false, redo: false }
const step = (description: string): Step => ({ name: { kind: 'write', description }, changes: [] })

describe('undoItems', () => {
  test('with nothing to undo or redo, both are greyed out', () => {
    expect(undoItems(new History(), NONE)).toEqual({
      undo: { label: 'Undo', enabled: false },
      redo: { label: 'Redo', enabled: false },
    })
  })

  test('each names the step it would take back or put back', () => {
    const history = new History<Step>()
    history.record(step('Lunch'))
    history.record(step('Coffee'))
    history.undid()
    expect(undoItems(history, NONE)).toEqual({
      undo: { label: 'Undo write Lunch', enabled: true },
      redo: { label: 'Redo write Coffee', enabled: true },
    })
  })

  test("a field's typing comes first", () => {
    const history = new History<Step>()
    history.record(step('Lunch'))
    expect(undoItems(history, { undo: true, redo: false })).toEqual({
      undo: { label: 'Undo typing', enabled: true },
      redo: { label: 'Redo', enabled: false },
    })
    expect(undoItems(history, { undo: false, redo: true }).redo).toEqual({
      label: 'Redo typing',
      enabled: true,
    })
  })

  test('every kind of step is named', () => {
    const history = new History<Step>()
    history.record({ name: { kind: 'saveAll', count: 3 }, changes: [] })
    expect(undoItems(history, NONE).undo.label).toBe('Undo save 3 spends')
    history.record({ name: { kind: 'edit', description: 'Tea' }, changes: [] })
    expect(undoItems(history, NONE).undo.label).toBe('Undo edit Tea')
  })
})

describe('typingFrom', () => {
  test('takes two booleans from the window, and nothing else', () => {
    expect(typingFrom({ undo: true, redo: false })).toEqual({ undo: true, redo: false })
    expect(typingFrom({ undo: 'yes', redo: 1, label: 'Undo all' })).toEqual(NONE)
    for (const said of [null, undefined, 'undo', 42, []]) expect(typingFrom(said)).toEqual(NONE)
  })
})
