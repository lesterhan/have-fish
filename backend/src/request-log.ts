/**
 * The middleware that writes one line per request, through the allowlist in `logging.ts`.
 *
 * Replaces `hono/logger`, which wrote two unstructured lines per request (`<-- GET /x`,
 * then `--> GET /x 200 3ms`) with the raw path in both. Unstructured is unqueryable, the
 * raw path carries account and transaction ids, and two lines per request is twice the
 * volume for less information.
 */

import type { MiddlewareHandler } from 'hono'
import type pino from 'pino'
import type { AppVariables } from './app'
import { log, logRequest } from './logging'

/**
 * `content-length`, when the runtime set one.
 *
 * Bun leaves it off a streamed JSON response, so this is absent more often than not. It is
 * read rather than measured on purpose: measuring means buffering the body, and a logger
 * that changes how responses are sent is a worse trade than a field that is sometimes
 * missing.
 */
function declaredByteSize(res: Response): number | undefined {
  const header = res.headers.get('content-length')
  if (header === null) return undefined
  const size = Number(header)
  return Number.isFinite(size) ? size : undefined
}

/**
 * The most specific pattern this request matched.
 *
 * `c.req.routePath` is the pattern of the handler that answered, which for anything the
 * auth middleware turns away is `/api/*` — so every 401 would look alike and nothing would
 * say which endpoint was being probed. Hono resolves all the handlers for a path up front,
 * so the real route is in `matchedRoutes` even when it never ran.
 *
 * A path that matched no route at all has only wildcards here, and falls back to one of
 * them rather than to the path asked for.
 */
function matchedPattern(c: {
  req: { matchedRoutes: { path: string }[]; routePath: string }
}): string {
  for (let i = c.req.matchedRoutes.length - 1; i >= 0; i--) {
    const path = c.req.matchedRoutes[i]?.path
    if (path !== undefined && !path.endsWith('*')) return path
  }
  return c.req.routePath
}

/**
 * One line per request, written after the handler has run.
 *
 * After, because that is when the status, the duration, and the user id the auth
 * middleware resolved all exist. A request that throws is logged by Hono's own error
 * handling rather than here; this line means "a response was produced".
 */
export function requestLogger(logger: pino.Logger = log): MiddlewareHandler<{
  Variables: Partial<AppVariables>
}> {
  return async (c, next) => {
    const startedAt = performance.now()
    await next()
    logRequest(
      {
        userId: c.get('userId') ?? null,
        // The matched pattern, not the path asked for — `/api/accounts/:id`, never the id.
        route: matchedPattern(c),
        method: c.req.method,
        status: c.res.status,
        // Tenths of a millisecond. Whole ones round most of this API's routes to `0`.
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        byteSize: declaredByteSize(c.res),
      },
      logger,
    )
  }
}
