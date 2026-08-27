import { describe, it, expect } from 'bun:test'
import { attentionChip } from './attentionChip'

describe('attentionChip', () => {
  it('shows the count when there is something to act on', () => {
    expect(attentionChip(3)).toEqual({ show: true, label: '3 need attention' })
  })

  it('agrees with itself in the singular', () => {
    expect(attentionChip(1)).toEqual({ show: true, label: '1 needs attention' })
  })

  it('disappears entirely at zero rather than going disabled', () => {
    expect(attentionChip(0).show).toBe(false)
  })

  it('stays absent while the count is still unknown', () => {
    // Avoids flashing a chip in and out as the store loads.
    expect(attentionChip(null).show).toBe(false)
    expect(attentionChip(undefined).show).toBe(false)
  })
})
