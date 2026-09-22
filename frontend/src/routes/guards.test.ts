import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { isRedirect } from '@sveltejs/kit'

// What `loadSession` will answer with for the guard under test.
let session: () => Promise<{ id: string; email: string } | null>

mock.module('$lib/session', () => ({
  loadSession: () => session(),
  forgetSession: () => {},
}))

const { load: rootLoad } = await import('./+page')
const { load: authedLoad } = await import('./(authed)/+layout')

const USER = { id: 'u1', email: 'a@b.c' }

/** Runs a load and reports where it redirected, or `null` if it returned instead. */
async function redirectOf(load: () => unknown): Promise<string | null> {
  try {
    await load()
    return null
  } catch (e) {
    if (isRedirect(e)) return e.location
    throw e
  }
}

beforeEach(() => {
  session = async () => USER
})

describe('the root route', () => {
  it('sends a signed-in visitor to the home surface', async () => {
    expect(await redirectOf(rootLoad as () => unknown)).toBe('/accounts')
  })

  it('sends a signed-out visitor to sign in', async () => {
    session = async () => null
    expect(await redirectOf(rootLoad as () => unknown)).toBe('/login')
  })

  // Fail towards the sign-in form: it says what went wrong, an empty page does not.
  it('sends a visitor to sign in when the session cannot be fetched', async () => {
    session = async () => {
      throw new Error('backend unreachable')
    }
    expect(await redirectOf(rootLoad as () => unknown)).toBe('/login')
  })

  it('never renders — it always redirects somewhere', async () => {
    for (const s of [async () => USER, async () => null]) {
      session = s
      expect(await redirectOf(rootLoad as () => unknown)).not.toBeNull()
    }
  })
})

describe('the authenticated layout', () => {
  it('lets a signed-in visitor through, and hands on the user', async () => {
    const data = await (authedLoad as () => Promise<{ user: typeof USER }>)()
    expect(data.user).toEqual(USER)
  })

  it('turns a signed-out visitor away', async () => {
    session = async () => null
    expect(await redirectOf(authedLoad as () => unknown)).toBe('/login')
  })

  it('turns a visitor away when the session cannot be fetched', async () => {
    session = async () => {
      throw new Error('backend unreachable')
    }
    expect(await redirectOf(authedLoad as () => unknown)).toBe('/login')
  })
})
