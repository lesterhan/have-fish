import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { auth } from './auth'
import accountsRoute from './routes/accounts'
import transactionsRoute from './routes/transactions'

export const app = new Hono()

app.use('*', cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:8888',
  credentials: true,
}))
app.use('*', logger())

app.get('/health', (c) => c.json({ status: 'ok' }))

// Better Auth handles all /api/auth/** routes (sign-in, sign-up, sign-out, session, etc.)
app.on(['GET', 'POST'], '/api/auth/**', (c) => auth.handler(c.req.raw))

// Protect all /api/* routes (except /api/auth/*) — reject requests without a valid session
app.use('/api/*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'Unauthorized' }, 401)
  // TODO: store session/user on context if routes need to know who's logged in
  return next()
})

app.route('/api/accounts', accountsRoute)
app.route('/api/transactions', transactionsRoute)
