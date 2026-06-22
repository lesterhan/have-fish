import { describe, it, expect } from 'bun:test'
import { buildTrustedOrigins } from './auth'

describe('buildTrustedOrigins', () => {
  it('falls back to the localhost frontend when no env is set', () => {
    expect(buildTrustedOrigins({})).toEqual(['http://localhost:8888'])
  })

  it('uses FRONTEND_URL when set', () => {
    expect(buildTrustedOrigins({ FRONTEND_URL: 'https://app.example.com' })).toEqual([
      'https://app.example.com',
    ])
  })

  it('appends TRUSTED_ORIGINS so the mobile app can point at another host', () => {
    expect(
      buildTrustedOrigins({
        FRONTEND_URL: 'https://app.example.com',
        TRUSTED_ORIGINS: 'https://host.tailnet.ts.net',
      }),
    ).toEqual(['https://app.example.com', 'https://host.tailnet.ts.net'])
  })

  it('parses a comma-separated list, trimming whitespace and dropping empties', () => {
    expect(
      buildTrustedOrigins({
        FRONTEND_URL: 'https://app.example.com',
        TRUSTED_ORIGINS: ' https://a.ts.net , https://b.ts.net ,,',
      }),
    ).toEqual(['https://app.example.com', 'https://a.ts.net', 'https://b.ts.net'])
  })
})
