import { describe, expect, test } from 'vitest'
import { copy } from '.'

describe('the words for a step', () => {
  test('name what it would take back or put back', () => {
    expect(copy.steps.undo.write({ kind: 'write', description: 'Lunch' })).toBe('Undo write Lunch')
    expect(copy.steps.redo.edit({ kind: 'edit', description: 'Tea' })).toBe('Redo edit Tea')
    expect(copy.steps.undo.saveAll({ kind: 'saveAll', count: 3 })).toBe('Undo save 3 spends')
  })

  test('still read as a sentence for a spend with no description', () => {
    expect(copy.steps.undo.write({ kind: 'write', description: '' })).toBe('Undo write a spend')
  })
})
