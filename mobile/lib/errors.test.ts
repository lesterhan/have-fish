import { describe, it, expect } from 'bun:test'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('unshouts a code', () => {
    expect(errorMessage({ error: 'ACCOUNT_NOT_FOUND' }, 'x')).toBe('Account not found.')
    expect(errorMessage({ error: 'SETTLEMENT_ALREADY_CONFIRMED' }, 'x')).toBe(
      'Settlement already confirmed.',
    )
  })

  it('passes prose through, so an older backend still reads correctly', () => {
    expect(errorMessage({ error: 'not a member of that group' }, 'x')).toBe(
      'not a member of that group',
    )
  })

  it('falls back on a body the API did not author', () => {
    expect(errorMessage(null, 'Failed to send invite')).toBe('Failed to send invite')
    expect(errorMessage({}, 'Failed to send invite')).toBe('Failed to send invite')
    expect(errorMessage('<html>502</html>', 'Failed to send invite')).toBe(
      'Failed to send invite',
    )
    expect(errorMessage({ error: '' }, 'Failed to send invite')).toBe('Failed to send invite')
  })
})
