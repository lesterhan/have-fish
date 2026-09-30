import { afterEach, describe, expect, it } from 'bun:test'
import { isCapabilities, launchTokenIn, quitLocalApp } from './capabilities'

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

describe('quitLocalApp', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** Answers every request with `answer` and records what was asked. */
  function answering(answer: () => Promise<Response>): Array<[string, RequestInit | undefined]> {
    const asked: Array<[string, RequestInit | undefined]> = []
    globalThis.fetch = Object.assign(
      (input: string | URL | Request, init?: RequestInit) => {
        asked.push([String(input), init])
        return answer()
      },
      { preconnect: realFetch.preconnect },
    )
    return asked
  }

  it('posts to the quit route, and reports the app agreed only on a 202', async () => {
    const asked = answering(async () => new Response(null, { status: 202 }))
    expect(await quitLocalApp()).toBe(true)
    expect(asked).toEqual([['/api/local/quit', { method: 'POST' }]])
  })

  it('reports a refusal or a dead connection as not quit, rather than throwing', async () => {
    answering(async () => new Response(null, { status: 401 }))
    expect(await quitLocalApp()).toBe(false)
    answering(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await quitLocalApp()).toBe(false)
  })
})
