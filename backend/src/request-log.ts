/**
 * The middleware that writes one line per request, through the allowlist in `logging.ts`.
 *
 * Replaces `hono/logger`, which wrote two unstructured lines per request (`<-- GET /x`,
 * then `--> GET /x 200 3ms`) with the raw path in both. Unstructured is unqueryable, the
 * raw path carries account and transaction ids, and two lines per request is twice the
 * volume for less information.
 */

import { DrizzleQueryError } from 'drizzle-orm'
import type { ErrorHandler, MiddlewareHandler } from 'hono'
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

/** What an unhandled error is written down as. */
export type LoggedError = { message: string; stack: string | undefined; code: string | undefined }

/**
 * The message, stack and code of an error, from the error that actually went wrong.
 *
 * Since Drizzle 0.44 a failed query throws `DrizzleQueryError`, whose message is
 * `Failed query: <sql>\nparams: <values>` and whose stack opens with that same message. The
 * values are whatever the request wrote (a description, an amount, an email), so logging
 * the wrapper would put a request body in the log by the back door. The driver's error is
 * on `cause`, and its message names the constraint or the syntax that failed, which is what
 * the line is for; its `code` (SQLSTATE on Postgres) says the same thing in a form a query
 * over the log can group by.
 *
 * Fields by name, never the error object: a thrown object from a driver or a fetch can carry
 * the request that caused it (the Postgres driver's errors hold `parameters`), and that
 * request can carry a body.
 */
export function loggedError(err: Error): LoggedError {
  if (err instanceof DrizzleQueryError) {
    if (err.cause instanceof Error) return loggedError(err.cause)
    // A wrapper with nothing inside: say that a query failed, and nothing it was given.
    return { message: 'query failed', stack: undefined, code: undefined }
  }
  const code = (err as { code?: unknown }).code
  return {
    message: err.message,
    stack: err.stack,
    code: typeof code === 'string' ? code : undefined,
  }
}

/**
 * The line for a request that threw.
 *
 * An unhandled throw otherwise reaches stderr as Hono's own unstructured dump, which is the
 * one request path the request logger does not own, and the path that matters most when
 * something is wrong at 2am. The response is byte-for-byte what Hono's default returns, so
 * this changes what is written down and nothing a client sees.
 */
export function unhandledError(logger: pino.Logger = log): ErrorHandler {
  return (err, c) => {
    logger.error(
      { route: c.req.routePath, method: c.req.method, err: loggedError(err) },
      'unhandled error',
    )
    return c.text('Internal Server Error', 500)
  }
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
