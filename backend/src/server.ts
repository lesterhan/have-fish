import { Hono, type MiddlewareHandler } from 'hono'
import { serveStatic } from 'hono/bun'
import type { AppEnv } from './build-app'

/**
 * Where the built frontend comes from: a folder on disk (the image, `bun run local`), or the
 * files a compiled binary carries inside itself (#288), keyed by the path each is served at.
 */
export type Frontend = { root: string } | { files: ReadonlyMap<string, string> }

/**
 * The API, with the built frontend in front of it when this deployment carries one.
 *
 * Serving both from one origin is what lets the separate frontend container go away: no
 * proxy hop, no CORS in production, one port. It is also the shape the local binary needs
 * (D7, and P2.3) — the same server binding a port and handing out the same assets.
 *
 * Lives here rather than in `app.ts` because the test suite imports `app`, and rather than
 * in `index.ts` because that is the entry point and this needs testing. It takes the app
 * rather than importing it because each build brings its own (`build-app.ts`).
 */
export async function createServer(app: Hono<AppEnv>, frontend: Frontend): Promise<Hono> {
  const server = new Hono()

  // The API and /health first, so no static file can shadow a route.
  server.route('/', app)

  // An unknown /api path answers as the API, not as the app shell. Without this the
  // single-page fallback below would hand a client expecting JSON an HTML document with a
  // 200, and it would fail somewhere far less obvious. `c.notFound()` is what an unmatched
  // route returned before the frontend moved in here, so this preserves that exactly.
  server.all('/api/*', (c) => c.notFound())

  if (!(await hasFrontend(frontend))) {
    return server
  }

  server.use(
    '*',
    'root' in frontend ? serveStatic({ root: frontend.root }) : serveEmbedded(frontend.files),
  )

  // A build asset that is not on disk is a real 404, never the app shell. These names are
  // content-hashed, so the only way to ask for a missing one is to be holding a stale
  // document — a browser part-way through a deploy, say. Answering that with HTML and a
  // 200 makes the module loader fail on `Unexpected token '<'` instead of saying plainly
  // that the file is gone.
  server.all('/_app/*', (c) => c.notFound())

  // Everything else is a single-page route: an unknown path is not a 404, it is a route
  // the browser has not resolved yet. Hand over the document and let the client router
  // deal with it.
  server.get(
    '*',
    'root' in frontend
      ? serveStatic({ path: 'index.html', root: frontend.root })
      : () => embedded(frontend.files.get('/index.html') ?? ''),
  )

  return server
}

/** Whether there is a frontend build to serve. */
export async function hasFrontend(frontend: Frontend): Promise<boolean> {
  return 'root' in frontend
    ? Bun.file(`${frontend.root}/index.html`).exists()
    : frontend.files.has('/index.html')
}

/**
 * The binary's counterpart of `serveStatic`: a file it carries, when the path names one.
 * Only an exact match is served, so no path can reach outside the list.
 */
function serveEmbedded(files: ReadonlyMap<string, string>): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
    let path: string
    try {
      path = decodeURIComponent(c.req.path)
    } catch {
      return next()
    }
    const file = files.get(path)
    return file ? embedded(file) : next()
  }
}

// Bun names an embedded file after the original, extension included, so its type is right.
const embedded = (file: string) =>
  new Response(Bun.file(file), { headers: { 'Content-Type': Bun.file(file).type } })
