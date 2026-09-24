import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { app } from './app'

/**
 * The API, with the built frontend in front of it when this deployment carries one.
 *
 * Serving both from one origin is what lets the separate frontend container go away: no
 * proxy hop, no CORS in production, one port. It is also the shape the local binary needs
 * (D7, and P2.3) — the same server binding a port and handing out the same assets.
 *
 * Lives here rather than in `app.ts` because the test suite imports `app`, and rather than
 * in `index.ts` because that is the entry point and this needs testing.
 */
export async function createServer(staticRoot: string): Promise<Hono> {
  const server = new Hono()

  // The API and /health first, so no static file can shadow a route.
  server.route('/', app)

  // An unknown /api path answers as the API, not as the app shell. Without this the
  // single-page fallback below would hand a client expecting JSON an HTML document with a
  // 200, and it would fail somewhere far less obvious. `c.notFound()` is what an unmatched
  // route returned before the frontend moved in here, so this preserves that exactly.
  server.all('/api/*', (c) => c.notFound())

  if (!(await Bun.file(`${staticRoot}/index.html`).exists())) {
    return server
  }

  server.use('*', serveStatic({ root: staticRoot }))

  // A build asset that is not on disk is a real 404, never the app shell. These names are
  // content-hashed, so the only way to ask for a missing one is to be holding a stale
  // document — a browser part-way through a deploy, say. Answering that with HTML and a
  // 200 makes the module loader fail on `Unexpected token '<'` instead of saying plainly
  // that the file is gone.
  server.all('/_app/*', (c) => c.notFound())

  // Everything else is a single-page route: an unknown path is not a 404, it is a route
  // the browser has not resolved yet. Hand over the document and let the client router
  // deal with it.
  server.get('*', serveStatic({ path: 'index.html', root: staticRoot }))

  return server
}

/** Whether a frontend build is present at `staticRoot`. */
export function hasFrontend(staticRoot: string): Promise<boolean> {
  return Bun.file(`${staticRoot}/index.html`).exists()
}
