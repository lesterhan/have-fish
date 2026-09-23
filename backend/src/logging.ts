/**
 * What this service is allowed to say about a request.
 *
 * `have-fish-server`'s README states the rule as an absolute — *no payload in logs; log
 * account id, row count, byte size, timing; never a row body, even though it is
 * ciphertext.* That is a rule a person has to hold in their head on every logging line
 * they or a model ever writes, and rules like that survive until the first 2am debugging
 * session, when someone logs the request body to find out what is going on and does not
 * take it out again.
 *
 * An allowlist inverts it. `RequestLog` below is the entire vocabulary of a request log
 * line, and `logRequest` copies those fields by name rather than spreading what it was
 * given — so a payload cannot be logged on the request path, because there is nowhere to
 * put one. The rule stops being discipline and becomes a compile error.
 *
 * Redaction is the second line: error paths and anything a library logs do not come
 * through `logRequest`, so the logger censors the key names that carry secrets wherever
 * they appear.
 */

import pino from 'pino'

/**
 * The only shape a request may be logged in.
 *
 * `route` is Hono's matched pattern (`/api/accounts/:id/coverage`), not the path that was
 * asked for. The pattern is what aggregates across requests, and it is also what keeps the
 * ids in a URL out of the log — a smaller leak than a body, and free to close.
 *
 * `byteSize` appears when the runtime declared a `content-length`. The relay's rule names
 * a `rowCount` beside it; it is not here, because a field nothing sets is a comment rather
 * than an allowlist entry. A field arrives in this type in the diff that starts populating
 * it, and that diff is the review this type exists to make possible.
 */
export type RequestLog = {
  /** Who asked. `null` before sign-in, and for `/health`. */
  userId: string | null
  route: string
  method: string
  status: number
  durationMs: number
  byteSize?: number | undefined
}

/**
 * Key names that carry a secret, censored wherever they appear.
 *
 * One level of nesting is covered explicitly because pino's paths are literal: `*.foo`
 * matches a key one level down, and a deeper object is not something this service logs.
 */
const SECRET_KEYS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'payload',
  'blob',
  'body',
]

const REDACT_PATHS = [...SECRET_KEYS, ...SECRET_KEYS.map((key) => `*.${key}`)]

/**
 * Quieter in production than in development, silent under test unless a test asks
 * otherwise. `LOG_LEVEL` overrides all three.
 */
function configuredLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL
  if (process.env.NODE_ENV === 'test') return 'silent'
  if (process.env.NODE_ENV === 'production') return 'info'
  return 'debug'
}

/**
 * A logger with this service's redaction and level rules.
 *
 * `destination` is what makes the allowlist testable: a test builds a logger writing into
 * an array and reads back exactly what would have gone to stdout.
 */
export function createLogger(
  destination?: pino.DestinationStream,
  level: string = configuredLevel(),
): pino.Logger {
  const options: pino.LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  }
  return destination ? pino(options, destination) : pino(options)
}

/** The service's own logger. Startup, shutdown, and anything that is not a request. */
export const log = createLogger()

/**
 * The fields of `entry`, named one at a time.
 *
 * A spread would carry whatever the caller actually passed, which is the hole this module
 * exists to close: a handler that builds its log object from a request body would leak it
 * through a type the compiler had already approved. Naming each field means the object
 * that reaches pino is built here, from this list, and nowhere else.
 *
 * It is also how a new field announces itself — adding a required one to `RequestLog`
 * without naming it below stops this function type-checking.
 */
function allowedFieldsOnly(entry: RequestLog): RequestLog {
  const { userId, route, method, status, durationMs, byteSize } = entry
  return { userId, route, method, status, durationMs, byteSize }
}

/** Write one request log line. The only way to log on a request path. */
export function logRequest(entry: RequestLog, logger: pino.Logger = log): void {
  logger.info(allowedFieldsOnly(entry), 'request')
}
