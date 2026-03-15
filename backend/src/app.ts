import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { auth } from './auth'
import accountsRoute from './routes/accounts'
import categoriesRoute from './routes/categories'
import transactionsRoute from './routes/transactions'

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

// Better Auth handles all /api/auth/** routes (sign-in, sign-up, sign-out, session, etc.)
app.on(['GET', 'POST'], '/api/auth/**', (c) => auth.handler(c.req.raw))

// Protect all /api/* routes (except /api/auth/*) — reject requests without a valid session.
// Stores the authenticated user's ID on context so route handlers can scope queries.
app.use('/api/*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'Unauthorized' }, 401)
  c.set('userId', session.user.id)
  return next()
})

app.route('/api/accounts', accountsRoute)
app.route('/api/categories', categoriesRoute)
app.route('/api/transactions', transactionsRoute)
