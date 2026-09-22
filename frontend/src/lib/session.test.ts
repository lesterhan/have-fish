import { describe, it, expect, beforeEach, mock } from 'bun:test'

// What the mocked client will answer with, and how many times it was asked.
let answer: () => Promise<{ data: { user: { id: string; email: string } } | null }>
let calls = 0

mock.module('$lib/auth', () => ({
  authClient: {
    getSession: () => {
      calls += 1
      return answer()
    },
  },
}))

const { loadSession, forgetSession } = await import('./session')

const USER = { id: 'u1', email: 'a@b.c' }

beforeEach(() => {
  calls = 0
  forgetSession()
  answer = async () => ({ data: { user: USER } })
})

describe('loadSession', () => {
  it('returns the user', async () => {
    expect(await loadSession()).toEqual(USER)
  })

  it('returns null when there is no session', async () => {
    answer = async () => ({ data: null })
    expect(await loadSession()).toBeNull()
  })

  it('asks the backend once, however many callers there are', async () => {
    // Two guards can run for one navigation — the root redirect and the authed layout.
    await Promise.all([loadSession(), loadSession(), loadSession()])
    expect(calls).toBe(1)
  })

  it('does not re-ask on a later navigation', async () => {
    await loadSession()
    await loadSession()
    expect(calls).toBe(1)
  })

  it('asks again after the session is forgotten', async () => {
    await loadSession()
    forgetSession()
    await loadSession()
    expect(calls).toBe(2)
  })

  // The bug this prevents: a cached rejection would make every guard for the rest of the
  // page load reuse the failure and bounce a signed-in user to /login.
  it('does not cache a failure', async () => {
    answer = async () => {
      throw new Error('backend restarting')
    }
    await expect(loadSession()).rejects.toThrow('backend restarting')

    answer = async () => ({ data: { user: USER } })
    expect(await loadSession()).toEqual(USER)
    expect(calls).toBe(2)
  })

  it('still caches normally after recovering from a failure', async () => {
    answer = async () => {
      throw new Error('nope')
    }
    await expect(loadSession()).rejects.toThrow()
    answer = async () => ({ data: { user: USER } })
    await loadSession()
    await loadSession()
    // One failed call, one that succeeded, and the third served from the cache.
    expect(calls).toBe(2)
  })
})
