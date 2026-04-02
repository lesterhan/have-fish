import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { auth } from './auth'
import accountsRoute from './routes/accounts'
import transactionsRoute from './routes/transactions'
import postingsRoute from './routes/postings'
import importRoute from './routes/import'
import parsersRoute from './routes/parsers'
import userSettingsRoute from './routes/user-settings'
import reportsRoute from './routes/reports'

// Typed context variables shared across all route handlers.
// Add new entries here as routes need more session data.
export type AppVariables = {
  userId: string
}

export const app = new Hono<{ Variables: AppVariables }>()

app.use('*', cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:8888',
  credentials: true,
}))
app.use('*', logger())

app.get('/health', (c) => c.json({ status: 'ok' }))

// Protect all /api/* routes except /api/auth/** — reject requests without a valid session.
// Registered before the auth handler so Hono's middleware-first execution model works correctly.
// The path guard is explicit rather than relying on registration order, which can break when
// sub-routers add wildcard or parameterised routes.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next()
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'Unauthorized' }, 401)
  c.set('userId', session.user.id)
  return next()
})

// Better Auth handles all /api/auth/** routes (sign-in, sign-up, sign-out, session, etc.)
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.route('/api/accounts', accountsRoute)
app.route('/api/transactions', transactionsRoute)
app.route('/api/postings', postingsRoute)
app.route('/api/import', importRoute)
app.route('/api/parsers', parsersRoute)
app.route('/api/user-settings', userSettingsRoute)
app.route('/api/reports', reportsRoute)
