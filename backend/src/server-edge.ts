import { cors } from 'hono/cors'
import { auth } from './auth'
import type { Edge } from './build-app'
import { fail } from './respond'

/**
 * The hosted edition's edge: Better Auth sessions, CORS for the dev frontend and the mobile
 * app, and Fish Pie.
 */
export const serverEdge: Edge = {
  capabilities: { mode: 'server', fishPie: true },

  guard: cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:8888',
    credentials: true,
  }),

  isOpen: (path) => path.startsWith('/api/auth/'),

  authenticate: async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return fail(c, 'UNAUTHORIZED')
    c.set('userId', session.user.id)
    return next()
  },

  // Better Auth handles all /api/auth/** routes (sign-in, sign-up, sign-out, session, etc.)
  mountOpenRoutes: (app) => {
    app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  },
}
