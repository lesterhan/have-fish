import { describe, expect, it } from 'bun:test'
import { errorMessage, thrownMessage } from './errors'

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
    expect(errorMessage('<html>502</html>', 'Failed to send invite')).toBe('Failed to send invite')
    expect(errorMessage({ error: '' }, 'Failed to send invite')).toBe('Failed to send invite')
  })
})

describe('thrownMessage', () => {
  it('reads the message off a thrown Error', () => {
    expect(thrownMessage(new Error('Group is gone'), 'x')).toBe('Group is gone')
  })

  it('reads it off any object that carries one', () => {
    expect(thrownMessage({ message: 'Network request failed' }, 'x')).toBe('Network request failed')
  })

  it('falls back on everything that carries no message', () => {
    expect(thrownMessage(undefined, 'Failed to load')).toBe('Failed to load')
    expect(thrownMessage(null, 'Failed to load')).toBe('Failed to load')
    expect(thrownMessage('boom', 'Failed to load')).toBe('Failed to load')
    expect(thrownMessage({ message: 42 }, 'Failed to load')).toBe('Failed to load')
  })

  it('falls back on an empty message rather than showing nothing', () => {
    expect(thrownMessage(new Error(''), 'Failed to load')).toBe('Failed to load')
  })
})
