import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The cache in `session.ts` is per page load, and both sign-in and sign-out change the
// answer without a page load happening. Neither is reachable from a unit test — one is a
// form handler, the other a dialog handler — so this holds the contract at the source,
// the way `chromeButtons.test.ts` does for the titlebar.
//
// What breaks without it is quiet and confusing: sign in successfully, get redirected to
// the app, and the authed guard reuses the "no session" it cached on the way to /login and
// puts you straight back on the form. Nothing errors. It just will not let you in.
const SRC = join(import.meta.dir, '..')
const LOGIN = readFileSync(join(SRC, 'routes/login/+page.svelte'), 'utf8')
const LAYOUT = readFileSync(join(SRC, 'routes/+layout.svelte'), 'utf8')

describe('the cached session', () => {
  it('is dropped when signing in', () => {
    expect(LOGIN).toContain("import { forgetSession } from '$lib/session'")
    expect(LOGIN).toContain('forgetSession()')
  })

  it('is dropped before the post-sign-in navigation, not after', () => {
    const forget = LOGIN.indexOf('forgetSession()')
    const go = LOGIN.indexOf('goto(HOME)')
    expect(forget).toBeGreaterThan(-1)
    expect(go).toBeGreaterThan(-1)
    expect(forget).toBeLessThan(go)
  })

  it('is dropped when signing out', () => {
    expect(LAYOUT).toContain("import { forgetSession } from '$lib/session'")
    expect(LAYOUT).toContain('forgetSession()')
  })

  it('is dropped before the sign-out navigation, not after', () => {
    const forget = LAYOUT.indexOf('forgetSession()')
    const go = LAYOUT.indexOf("goto('/login')")
    expect(forget).toBeGreaterThan(-1)
    expect(go).toBeGreaterThan(-1)
    expect(forget).toBeLessThan(go)
  })
})
