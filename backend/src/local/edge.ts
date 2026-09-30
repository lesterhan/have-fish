import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import type { Edge } from '../build-app'
import { fail } from '../respond'
import { parseBody } from '../validation'
import { launchTokenRedeemer, randomSecret, sameSecret } from './launch-token'
import type { LocalUser } from './profile-service'

/** The session cookie. Its value lives only in this process, so a restart ends every session. */
export const LOCAL_SESSION_COOKIE = 'havefish_local'

const Exchange = z.object({ token: z.string() })

type LocalEdgeOptions = {
  /** The port this process is bound to on 127.0.0.1. */
  port: number
  /** The launch key from the lockfile, which launch tokens are signed with. */
  launchKey: string
  /** The local profile's user: every request with a session is this user. */
  user: LocalUser
  /** Stops the app the way SIGINT does (#511). Called once the answer to the request is sent. */
  quit: () => void
}

/**
 * The local build's edge (#287, L07 §1). No Better Auth and no sign-in: a page gets a session
 * only by redeeming a launch token, and every session is the local profile. No CORS headers
 * at all, so a page on another origin cannot read an answer even when it can send a request.
 */
export function localEdge({ port, launchKey, user, quit }: LocalEdgeOptions): Edge {
  const host = `127.0.0.1:${port}`
  const origin = `http://${host}`
  const cookieValue = randomSecret()
  const redeem = launchTokenRedeemer(launchKey)

  const hasSession = (cookie: string | undefined) =>
    cookie !== undefined && sameSecret(cookie, cookieValue)

  return {
    capabilities: { mode: 'local', link: 'never', fishPie: false },

    // DNS rebinding points an attacker's name at 127.0.0.1, so the browser treats the page as
    // same-origin with it: the Host it sends is the attacker's name, and that is refused. A
    // cross-site request carries the page it came from in `Sec-Fetch-Site` and `Origin`, and
    // that is refused too. `same-site` is refused as well: any other port on 127.0.0.1 is the
    // same site, and nothing on those ports is this app. A request with neither header (curl,
    // a bookmark) passes this check and still has no session.
    guard: async (c, next) => {
      const site = c.req.header('sec-fetch-site')
      const from = c.req.header('origin')
      if (
        new URL(c.req.url).host !== host ||
        site === 'cross-site' ||
        site === 'same-site' ||
        (from !== undefined && from !== origin)
      ) {
        return fail(c, 'LOCAL_REQUEST_REFUSED')
      }
      return next()
    },

    isOpen: (path) => path === '/api/local/session' || path === '/api/auth/get-session',

    authenticate: async (c, next) => {
      if (!hasSession(getCookie(c, LOCAL_SESSION_COOKIE))) return fail(c, 'UNAUTHORIZED')
      c.set('userId', user.id)
      return next()
    },

    mountRoutes: (app) => {
      // POST /api/local/session — trade a launch token for the session cookie. `SameSite=Strict`
      // keeps the cookie off any request another site starts; `HttpOnly` keeps it from script.
      app.post('/api/local/session', async (c) => {
        const parsed = await parseBody(c, Exchange)
        if (!parsed.ok) return parsed.response
        if (!redeem(parsed.data.token)) return fail(c, 'LAUNCH_TOKEN_INVALID')
        setCookie(c, LOCAL_SESSION_COOKIE, cookieValue, {
          httpOnly: true,
          sameSite: 'Strict',
          path: '/',
        })
        return c.body(null, 204)
      })

      // GET /api/auth/get-session — the one Better Auth call the frontend makes on every page,
      // answered in the shape its client reads, so the frontend's session handling is the same
      // code in both builds. `null` is what Better Auth answers when there is no session.
      app.get('/api/auth/get-session', (c) => {
        if (!hasSession(getCookie(c, LOCAL_SESSION_COOKIE))) return c.json(null)
        return c.json({
          session: {
            id: 'local',
            userId: user.id,
            createdAt: user.createdAt,
            updatedAt: user.createdAt,
            // Better Auth's client wants a date; this session ends with the process instead.
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          user,
        })
      })

      // POST /api/local/quit — the titlebar's Quit (#511). Not open: `authenticate` runs first,
      // and the guard above has already turned away any page but this app's. The stop starts
      // after this answer is on its way; it lets requests in flight, this one among them, finish.
      app.post('/api/local/quit', (c) => {
        setTimeout(quit, 0)
        return c.body(null, 202)
      })
    },
  }
}
