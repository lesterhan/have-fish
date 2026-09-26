import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './auth'
import { fail } from './errors'
import { log } from './logging'
import { requestLogger } from './request-log'
import accountsRoute from './routes/accounts'
import catchUpRoute from './routes/catch-up'
import coverageRoute, { accountCoverageRoute } from './routes/coverage'
import fishPieBalancesRoute from './routes/fish-pie-balances'
import fishPieCategoriesRoute from './routes/fish-pie-categories'
import fishPieExpensesRoute from './routes/fish-pie-expenses'
import fishPieGroupsRoute from './routes/fish-pie-groups'
import fishPieInvitesRoute from './routes/fish-pie-invites'
import fishPieMergeRoute from './routes/fish-pie-merge'
import fishPieOverviewRoute from './routes/fish-pie-overview'
import fishPieSettlementsRoute from './routes/fish-pie-settlements'
import fxRatesRoute from './routes/fx-rates'
import importRoute from './routes/import'
import parsersRoute from './routes/parsers'
import reportsRoute from './routes/reports'
import rulesRoute from './routes/rules'
import transactionsRoute from './routes/transactions'
import userSettingsRoute from './routes/user-settings'

// Typed context variables shared across all route handlers.
// Add new entries here as routes need more session data.
export type AppVariables = {
  userId: string
}

export const app = new Hono<{ Variables: AppVariables }>()

app.use(
  '*',
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:8888',
    credentials: true,
  }),
)
app.use('*', requestLogger())

// An unhandled throw otherwise reaches stderr as Hono's own unstructured dump, which is
// the one request path the logger does not own — and the path that matters most when
// something is wrong at 2am. The response is byte-for-byte what Hono's default returns, so
// this changes what is written down and nothing a client sees.
app.onError((err, c) => {
  log.error(
    {
      route: c.req.routePath,
      method: c.req.method,
      // The message and stack, never the error object: a thrown object from a driver or a
      // fetch can carry the request that caused it, and that request can carry a body.
      err: { message: err.message, stack: err.stack },
    },
    'unhandled error',
  )
  return c.text('Internal Server Error', 500)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

// Protect all /api/* routes except /api/auth/** — reject requests without a valid session.
// Registered before the auth handler so Hono's middleware-first execution model works correctly.
// The path guard is explicit rather than relying on registration order, which can break when
// sub-routers add wildcard or parameterised routes.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next()
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return fail(c, 'UNAUTHORIZED')
  c.set('userId', session.user.id)
  return next()
})

// Better Auth handles all /api/auth/** routes (sign-in, sign-up, sign-out, session, etc.)
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// Registered before accountsRoute so /api/accounts/:id/coverage resolves here rather than
// falling into the account detail handler.
app.route('/api/accounts', accountCoverageRoute)
app.route('/api/accounts', accountsRoute)
app.route('/api/transactions', transactionsRoute)
app.route('/api/import', importRoute)
app.route('/api/parsers', parsersRoute)
app.route('/api/user-settings', userSettingsRoute)
app.route('/api/reports', reportsRoute)
app.route('/api/fx-rates', fxRatesRoute)
app.route('/api/rules', rulesRoute)
app.route('/api/fish-pie/groups', fishPieMergeRoute)
app.route('/api/fish-pie/groups', fishPieOverviewRoute)
app.route('/api/fish-pie/groups', fishPieGroupsRoute)
app.route('/api/fish-pie/groups', fishPieCategoriesRoute)
app.route('/api/fish-pie', fishPieInvitesRoute)
app.route('/api/fish-pie', fishPieExpensesRoute)
app.route('/api/fish-pie', fishPieBalancesRoute)
app.route('/api/fish-pie', fishPieSettlementsRoute)
app.route('/api/coverage', coverageRoute)
app.route('/api/catch-up', catchUpRoute)
