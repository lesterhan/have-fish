import { describe, it, expect } from 'bun:test'
import { once } from './once'

// No module mocking here on purpose. The previous version of these tests patched the
// module registry to stand in for the auth client, which passed locally and failed in CI
// for reasons that could not be reproduced outside it. The behaviour worth testing is a
// promise cache, which is pure — so it is tested with a plain counter and nothing else.

/** A fake async call that counts invocations and answers however the test says. */
function spy<T>(answer: () => Promise<T>) {
  let calls = 0
  const fn = () => {
    calls += 1
    return answer()
  }
  return { fn, get calls() { return calls } }
}

describe('once', () => {
  it('returns the value', async () => {
    const s = spy(async () => 'v')
    expect(await once(s.fn)()).toBe('v')
  })

  it('passes null through rather than treating it as absent', async () => {
    const s = spy(async () => null)
    const cached = once(s.fn)
    expect(await cached()).toBeNull()
    await cached()
    // A null result is a real answer — "no session" — so it must not re-run the fetch.
    expect(s.calls).toBe(1)
  })

  it('runs once however many callers arrive at the same time', async () => {
    const s = spy(async () => 'v')
    const cached = once(s.fn)
    await Promise.all([cached(), cached(), cached()])
    expect(s.calls).toBe(1)
  })

  it('runs once across later calls', async () => {
    const s = spy(async () => 'v')
    const cached = once(s.fn)
    await cached()
    await cached()
    expect(s.calls).toBe(1)
  })

  it('hands every caller the same promise', async () => {
    const cached = once(async () => 'v')
    expect(cached()).toBe(cached())
  })

  it('runs again after being forgotten', async () => {
    const s = spy(async () => 'v')
    const cached = once(s.fn)
    await cached()
    cached.forget()
    await cached()
    expect(s.calls).toBe(2)
  })

  // The bug this prevents: one blip while the backend restarts would otherwise be
  // replayed to every later caller, bouncing a signed-in user to /login for the rest of
  // the page load.
  it('does not cache a failure', async () => {
    let fail = true
    const s = spy(async () => {
      if (fail) throw new Error('backend restarting')
      return 'v'
    })
    const cached = once(s.fn)

    await expect(cached()).rejects.toThrow('backend restarting')
    fail = false
    expect(await cached()).toBe('v')
    expect(s.calls).toBe(2)
  })

  it('caches normally again after recovering from a failure', async () => {
    let fail = true
    const s = spy(async () => {
      if (fail) throw new Error('nope')
      return 'v'
    })
    const cached = once(s.fn)

    await expect(cached()).rejects.toThrow()
    fail = false
    await cached()
    await cached()
    // One failed call, one that succeeded, and the third served from the cache.
    expect(s.calls).toBe(2)
  })

  it('does not share state between two caches', async () => {
    const a = spy(async () => 'a')
    const b = spy(async () => 'b')
    const ca = once(a.fn)
    const cb = once(b.fn)
    expect(await ca()).toBe('a')
    expect(await cb()).toBe('b')
    ca.forget()
    await ca()
    expect(a.calls).toBe(2)
    expect(b.calls).toBe(1)
  })
})
