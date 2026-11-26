import { describe, expect, test } from 'vitest'
import { copy } from '.'

describe('the words for a step', () => {
  test('name what it would take back or put back', () => {
    expect(copy.steps.undo.write({ action: 'write', description: 'Lunch' })).toBe(
      'Undo write Lunch',
    )
    expect(copy.steps.redo.edit({ action: 'edit', description: 'Tea' })).toBe('Redo edit Tea')
  })

  test('still read as a sentence for a spend with no description', () => {
    expect(copy.steps.undo.write({ action: 'write', description: '' })).toBe('Undo write a spend')
  })

  test('name a rate by its currency and day', () => {
    expect(
      copy.steps.redo.writeRate({ action: 'writeRate', currency: 'GBP', date: '2026-11-05' }),
    ).toBe('Redo GBP rate for 2026-11-05')
  })

  test('name a rate written in one go, by one', () => {
    expect(copy.steps.said('undo', { action: 'writeAllRates', count: 1 })).toBe('Undo 1 rate')
  })

  test('count the rates a redo puts back', () => {
    expect(copy.steps.said('redo', { action: 'writeAllRates', count: 3 })).toBe('Redo 3 rates')
  })
})
