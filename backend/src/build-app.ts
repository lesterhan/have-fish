import { Hono, type MiddlewareHandler } from 'hono'
import { requestLogger, unhandledError } from './request-log'
import accountsRoute from './routes/accounts'
import catchUpRoute from './routes/catch-up'
import coverageRoute, { accountCoverageRoute } from './routes/coverage'
import exportRoute from './routes/export'
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
export type AppEnv = { Variables: AppVariables }

/**
 * What the frontend may show, answered before anyone signs in. Fish Pie is absent from a
 * local build that has never linked to its service, not disabled (D3): the nav entry goes,
 * rather than a tab that can never be used.
 */
export type Capabilities =
  | { mode: 'server'; fishPie: true }
  | { mode: 'local'; link: 'never'; fishPie: false }

/**
 * Everything that differs between the two builds, and nothing else (D7: "only the edges
 * differ"). The routes and services behind it are the same code in both.
 */
export type Edge = {
  capabilities: Capabilities
  /** Before everything, `/health` included: CORS on the server, the Host and Origin check locally. */
  guard: MiddlewareHandler
  /** The paths that answer without a session: signing in, or exchanging a launch token. */
  isOpen(path: string): boolean
  /** Sets `userId` for a request that carries a session, or answers 401. */
  authenticate: MiddlewareHandler<AppEnv>
  /** Mounts the open routes `isOpen` lets through. */
  mountOpenRoutes(app: Hono<AppEnv>): void
}

export function buildApp(edge: Edge): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', edge.guard)
  app.use('*', requestLogger())

  app.onError(unhandledError())

  app.get('/health', (c) => c.json({ status: 'ok' }))

  // Protect all /api/* routes except the edge's open ones: reject requests without a session.
  // Registered before the routes so Hono's middleware-first execution model works correctly.
  // The path guard is explicit rather than relying on registration order, which can break when
  // sub-routers add wildcard or parameterised routes.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/capabilities' || edge.isOpen(c.req.path)) return next()
    return edge.authenticate(c, next)
  })

  app.get('/api/capabilities', (c) => c.json(edge.capabilities))

  edge.mountOpenRoutes(app)

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
  app.route('/api/coverage', coverageRoute)
  app.route('/api/catch-up', catchUpRoute)
  app.route('/api/export', exportRoute)

  // Absent, not refused (D3): in a local build these paths are unknown, as they will be once
  // Fish Pie is its own service (#380).
  if (edge.capabilities.fishPie) {
    app.route('/api/fish-pie/groups', fishPieMergeRoute)
    app.route('/api/fish-pie/groups', fishPieOverviewRoute)
    app.route('/api/fish-pie/groups', fishPieGroupsRoute)
    app.route('/api/fish-pie/groups', fishPieCategoriesRoute)
    app.route('/api/fish-pie', fishPieInvitesRoute)
    app.route('/api/fish-pie', fishPieExpensesRoute)
    app.route('/api/fish-pie', fishPieBalancesRoute)
    app.route('/api/fish-pie', fishPieSettlementsRoute)
  }

  return app
}
