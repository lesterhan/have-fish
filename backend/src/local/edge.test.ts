// The local build's front door (#287, L07 §1), through the whole app as the local launcher
// builds it. Requests go to the URL the browser would use, so the Host check sees what a real
// request carries.

import { beforeEach, describe, expect, it } from 'bun:test'
import type { Hono } from 'hono'
import { app as serverApp } from '../app'
import { type AppEnv, buildApp } from '../build-app'
import { at, clearDatabase } from '../test-utils'
import { LOCAL_SESSION_COOKIE, localEdge } from './edge'
import { mintLaunchToken, randomSecret } from './launch-token'
import { ensureLocalProfile, type LocalUser } from './profile-service'

const PORT = 47999
const ORIGIN = `http://127.0.0.1:${PORT}`
const KEY = randomSecret()

let app: Hono<AppEnv>
let me: LocalUser

beforeEach(async () => {
  await clearDatabase()
  me = await ensureLocalProfile()
  app = buildApp(localEdge({ port: PORT, launchKey: KEY, user: me }))
})

async function send(path: string, init: RequestInit = {}, origin = ORIGIN): Promise<Response> {
  return app.request(`${origin}${path}`, init)
}

async function exchange(token: string): Promise<Response> {
  return send('/api/local/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

/** Signs in the way the page does, and returns the Cookie header to send after. */
async function signIn(): Promise<string> {
  const res = await exchange(mintLaunchToken(KEY))
  expect(res.status).toBe(204)
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('the exchange set no cookie')
  return cookie.split(';')[0] ?? ''
}

describe('the launch token exchange', () => {
  it('sets a session cookie that script cannot read and no other site can send', async () => {
    const res = await exchange(mintLaunchToken(KEY))
    expect(res.status).toBe(204)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toStartWith(`${LOCAL_SESSION_COOKIE}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
  })

  it('refuses a token twice', async () => {
    const token = mintLaunchToken(KEY)
    expect((await exchange(token)).status).toBe(204)
    const again = await exchange(token)
    expect(again.status).toBe(401)
    expect(await again.json()).toEqual({ error: 'LAUNCH_TOKEN_INVALID' })
  })

  it('refuses a token signed with another key', async () => {
    const res = await exchange(mintLaunchToken(randomSecret()))
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('refuses a body with no token', async () => {
    const res = await send('/api/local/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(400)
  })
})

describe('a request to the local app', () => {
  it('without the cookie gets nothing from the ledger', async () => {
    expect((await send('/api/accounts')).status).toBe(401)
    const forged = await send('/api/accounts', {
      headers: { Cookie: `${LOCAL_SESSION_COOKIE}=${randomSecret()}` },
    })
    expect(forged.status).toBe(401)
  })

  it('with it is the local profile, on the same routes the server build has', async () => {
    const cookie = await signIn()
    const created = await send('/api/accounts', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets:wise:cad' }),
    })
    expect(created.status).toBe(201)

    const listed = (await (
      await send('/api/accounts', { headers: { Cookie: cookie } })
    ).json()) as {
      path: string
      userId: string
    }[]
    expect(listed.map((a) => a.path)).toContain('assets:wise:cad')
    expect(at(listed, 0).userId).toBe(me.id)
  })

  it('reads the session in the shape the frontend’s auth client reads, or null', async () => {
    expect(await (await send('/api/auth/get-session')).json()).toBeNull()

    const cookie = await signIn()
    const body = (await (
      await send('/api/auth/get-session', { headers: { Cookie: cookie } })
    ).json()) as {
      session: { userId: string; expiresAt: string }
      user: { id: string; email: string }
    }
    expect(body.session.userId).toBe(me.id)
    expect(new Date(body.session.expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(body.user.id).toBe(me.id)
    expect(body.user.email).toBe(me.email)
  })

  it('finds no sign-in, sign-up or Fish Pie: they are absent, not refused', async () => {
    const cookie = await signIn()
    const json = { Cookie: cookie, 'Content-Type': 'application/json' }
    for (const [method, path] of [
      ['POST', '/api/auth/sign-up/email'],
      ['POST', '/api/auth/sign-in/email'],
      ['GET', '/api/fish-pie/groups'],
      ['GET', '/api/fish-pie/invites'],
    ] as const) {
      const res = await send(path, {
        method,
        headers: json,
        ...(method === 'POST' ? { body: '{}' } : {}),
      })
      expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`)
    }
  })

  it('says what the frontend may show, before anyone has a session', async () => {
    const res = await send('/api/capabilities')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'local', link: 'never', fishPie: false })
  })

  it('carries no CORS headers, so another origin cannot read an answer', async () => {
    const cookie = await signIn()
    const res = await send('/api/accounts', { headers: { Cookie: cookie } })
    expect([...res.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([])
  })
})

describe('the Host and Origin check', () => {
  const refused = async (res: Response) => {
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'LOCAL_REQUEST_REFUSED' })
  }

  it('refuses a Host that is not 127.0.0.1 on this port, which is what DNS rebinding sends', async () => {
    const cookie = await signIn()
    for (const origin of [
      `http://evil.example:${PORT}`,
      `http://localhost:${PORT}`,
      'http://127.0.0.1:47998',
      'http://127.0.0.1',
    ]) {
      await refused(await send('/api/accounts', { headers: { Cookie: cookie } }, origin))
    }
    // Before anything else answers: the exchange and /health are behind it too.
    await refused(await send('/health', {}, `http://evil.example:${PORT}`))
    await refused(
      await app.request(`http://evil.example:${PORT}/api/local/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: mintLaunchToken(KEY) }),
      }),
    )
  })

  it('refuses a request another site started, or another port on this machine', async () => {
    const cookie = await signIn()
    for (const site of ['cross-site', 'same-site']) {
      await refused(
        await send('/api/accounts', { headers: { Cookie: cookie, 'Sec-Fetch-Site': site } }),
      )
    }
  })

  it('refuses an Origin that is not this app, for browsers that send no Sec-Fetch-Site', async () => {
    const cookie = await signIn()
    for (const origin of ['http://evil.example', 'null', `http://localhost:${PORT}`]) {
      await refused(await send('/api/accounts', { headers: { Cookie: cookie, Origin: origin } }))
    }
  })

  it('lets the app’s own page through, and a typed URL or bookmark', async () => {
    const cookie = await signIn()
    for (const headers of [
      { 'Sec-Fetch-Site': 'same-origin', Origin: ORIGIN },
      { 'Sec-Fetch-Site': 'none' },
      {},
    ]) {
      expect(
        (await send('/api/accounts', { headers: { Cookie: cookie, ...headers } })).status,
      ).toBe(200)
    }
  })
})

describe('the server build', () => {
  it('says it has Fish Pie, before anyone signs in', async () => {
    const res = await serverApp.request('/api/capabilities')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'server', fishPie: true })
  })

  it('still mounts Fish Pie and Better Auth', async () => {
    expect((await serverApp.request('/api/fish-pie/groups')).status).toBe(401)
    const session = await serverApp.request('/api/auth/get-session')
    expect(session.status).toBe(200)
  })
})
