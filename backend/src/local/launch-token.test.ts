import { describe, expect, it } from 'bun:test'
import {
  LAUNCH_TOKEN_TTL_MS,
  launchTokenRedeemer,
  mintLaunchToken,
  randomSecret,
  sameSecret,
} from './launch-token'

const KEY = randomSecret()
const NOW = 1_800_000_000_000

describe('a launch token', () => {
  it('opens a session once', () => {
    const redeem = launchTokenRedeemer(KEY)
    const token = mintLaunchToken(KEY, NOW)
    expect(redeem(token, NOW + 1000)).toBe(true)
    expect(redeem(token, NOW + 2000)).toBe(false)
  })

  it('is accepted from any launch that holds the key, each one once', () => {
    const redeem = launchTokenRedeemer(KEY)
    const first = mintLaunchToken(KEY, NOW)
    const second = mintLaunchToken(KEY, NOW)
    expect(first).not.toBe(second)
    expect(redeem(first, NOW)).toBe(true)
    expect(redeem(second, NOW)).toBe(true)
  })

  it('expires', () => {
    const redeem = launchTokenRedeemer(KEY)
    expect(redeem(mintLaunchToken(KEY, NOW), NOW + LAUNCH_TOKEN_TTL_MS + 1)).toBe(false)
    expect(redeem(mintLaunchToken(KEY, NOW), NOW + LAUNCH_TOKEN_TTL_MS)).toBe(true)
  })

  it('is refused from the future, beyond a small clock allowance', () => {
    const redeem = launchTokenRedeemer(KEY)
    expect(redeem(mintLaunchToken(KEY, NOW + 60_000), NOW)).toBe(false)
    expect(redeem(mintLaunchToken(KEY, NOW + 1000), NOW)).toBe(true)
  })

  it('is refused when signed with another key', () => {
    const redeem = launchTokenRedeemer(KEY)
    expect(redeem(mintLaunchToken(randomSecret(), NOW), NOW)).toBe(false)
  })

  it('is refused when any part is changed', () => {
    const redeem = launchTokenRedeemer(KEY)
    const [issued, nonce, mac] = mintLaunchToken(KEY, NOW).split('.')
    expect(redeem(`${Number(issued) + 1}.${nonce}.${mac}`, NOW)).toBe(false)
    expect(redeem(`${issued}.${nonce}x.${mac}`, NOW)).toBe(false)
    expect(redeem(`${issued}.${nonce}.${mac}x`, NOW)).toBe(false)
  })

  it('is refused when it is not a token at all', () => {
    const redeem = launchTokenRedeemer(KEY)
    for (const junk of ['', '.', '..', 'a.b.c.d', 'not-a-token', `${NOW}..`]) {
      expect(redeem(junk, NOW)).toBe(false)
    }
  })
})

describe('sameSecret', () => {
  it('compares whole strings, of any length', () => {
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abd')).toBe(false)
    expect(sameSecret('ab', 'abc')).toBe(false)
    expect(sameSecret('', 'abc')).toBe(false)
  })
})
