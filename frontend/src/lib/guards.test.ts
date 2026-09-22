import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rootDestination, SIGN_IN } from './guards'
import { HOME } from './routes'

describe('rootDestination', () => {
  it('sends a signed-in visitor to the home surface', () => {
    expect(rootDestination({ id: 'u1', email: 'a@b.c' })).toBe(HOME)
  })

  it('sends a signed-out visitor to sign in', () => {
    expect(rootDestination(null)).toBe(SIGN_IN)
  })

  it('never returns nowhere — `/` always goes somewhere', () => {
    for (const user of [{ id: 'u1', email: 'a@b.c' }, null]) {
      expect(rootDestination(user)).toMatch(/^\//)
    }
  })
})

// The route files themselves are three lines of wiring each. What matters about them is
// the direction they fail in, which is asserted at the source the way
// `chromeButtons.test.ts` does for the titlebar — no router, no module patching.
const SRC = join(import.meta.dir, '..')
const ROOT = readFileSync(join(SRC, 'routes/+page.ts'), 'utf8')
const AUTHED = readFileSync(join(SRC, 'routes/(authed)/+layout.ts'), 'utf8')

describe('the guards', () => {
  it('treat an unreachable backend as signed out, not as an error page', () => {
    // Without the catch, a backend blip throws out of `load` and the visitor gets a
    // SvelteKit error page instead of the form that would let them back in.
    expect(ROOT).toContain('loadSession().catch(() => null)')
    expect(AUTHED).toContain('loadSession().catch(() => null)')
  })

  it('decide the root destination through the tested policy, not a second conditional', () => {
    expect(ROOT).toContain('rootDestination(user)')
  })

  it('turn a signed-out visitor away from the authed group', () => {
    expect(AUTHED).toContain('if (!user) throw redirect(302, SIGN_IN)')
  })
})
