import { describe, expect, it } from 'bun:test'
import { importCopy } from '../copy/import'
import { commitFailureMessage } from './commit-failure'

describe('commitFailureMessage', () => {
  it('names the row by its place in the review, not in the request', () => {
    // Preview rows 0 and 2 were skipped, so request row 1 is preview row 3: "Row 4".
    const body = { error: 'AMOUNT_INVALID', detail: { amount: '1,234.56', index: 1 } }
    expect(commitFailureMessage(body, [1, 3, 4])).toBe('Row 4: “1,234.56” is not an amount.')
  })

  it('keeps the number as it is when nothing was skipped', () => {
    const body = { error: 'AMOUNT_INVALID', detail: { amount: '', index: 2 } }
    expect(commitFailureMessage(body, [0, 1, 2])).toBe('Row 3: “” is not an amount.')
  })

  it('passes a refusal that names no row through as the server wrote it', () => {
    const body = { error: 'ACCOUNTS_NOT_FOUND' }
    expect(commitFailureMessage(body, [0])).not.toBe(importCopy.commit.failed)
    expect(commitFailureMessage(body, [0])).toBe(commitFailureMessage(body, [5, 6]))
  })

  it('keeps the backend number rather than inventing one past what was sent', () => {
    const body = { error: 'AMOUNT_INVALID', detail: { amount: 'x', index: 9 } }
    expect(commitFailureMessage(body, [0, 1])).toBe('Row 10: “x” is not an amount.')
  })

  it('falls back to the generic sentence for a body the API did not author', () => {
    expect(commitFailureMessage(null, [0])).toBe(importCopy.commit.failed)
    expect(commitFailureMessage('<html>502</html>', [0])).toBe(importCopy.commit.failed)
  })
})
