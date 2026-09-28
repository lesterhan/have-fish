import { describe, expect, it } from 'bun:test'
import { isCapabilities, launchTokenIn } from './capabilities'

describe('isCapabilities', () => {
  it('accepts what each build answers', () => {
    expect(isCapabilities({ mode: 'server', fishPie: true })).toBe(true)
    expect(isCapabilities({ mode: 'local', link: 'never', fishPie: false })).toBe(true)
  })

  it('refuses anything else, so a surprise falls back to the server build', () => {
    for (const value of [
      null,
      'local',
      {},
      { mode: 'local', fishPie: true },
      { mode: 'server', fishPie: false },
      { mode: 'desktop', fishPie: false },
    ]) {
      expect(isCapabilities(value)).toBe(false)
    }
  })
})

describe('launchTokenIn', () => {
  it('reads the token the launcher put in the fragment', () => {
    expect(launchTokenIn('#token=1790.abc.def')).toBe('1790.abc.def')
    expect(launchTokenIn('token=1790.abc.def')).toBe('1790.abc.def')
  })

  it('finds nothing in an ordinary fragment', () => {
    expect(launchTokenIn('')).toBeNull()
    expect(launchTokenIn('#')).toBeNull()
    expect(launchTokenIn('#section-2')).toBeNull()
    expect(launchTokenIn('#token=')).toBeNull()
  })
})
