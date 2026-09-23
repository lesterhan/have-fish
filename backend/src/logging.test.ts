/**
 * The allowlist, tested as a rule rather than as a shape.
 *
 * The assertion that matters is the last one in the first block: a request carrying a body
 * produces no log line containing any of it. That is `have-fish-server`'s "no payload in
 * logs" rule, made executable here before the repository it governs has any code in it.
 */

import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createLogger, logRequest, type RequestLog } from './logging'
import { requestLogger } from './request-log'

/** A logger writing into an array, so a test can read back what stdout would have got. */
function capturing(level = 'info') {
  const lines: string[] = []
  const logger = createLogger({ write: (line: string) => void lines.push(line) }, level)
  return {
    logger,
    lines,
    /** Everything written, as one string — what a `grep` over the log file would see. */
    all: () => lines.join(''),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('logRequest', () => {
  const entry: RequestLog = {
    userId: 'user-1',
    route: '/api/accounts/:id',
    method: 'GET',
    status: 200,
    durationMs: 3.4,
  }

  it('writes one JSON object per request', () => {
    const cap = capturing()
    logRequest(entry, cap.logger)

    expect(cap.lines).toHaveLength(1)
    expect(cap.entries()[0]).toMatchObject({
      userId: 'user-1',
      route: '/api/accounts/:id',
      method: 'GET',
      status: 200,
      durationMs: 3.4,
      msg: 'request',
    })
  })

  it('drops a field the type does not have, not just at compile time', () => {
    const cap = capturing()
    // The cast is the point: this is what a `JSON.parse` or an `as` upstream would hand
    // the logger, and the type alone would not have caught it.
    logRequest({ ...entry, note: 'bought a boat', amount: '-48000.00' } as RequestLog, cap.logger)

    const [written] = cap.entries()
    expect(Object.keys(written ?? {})).not.toContain('note')
    expect(Object.keys(written ?? {})).not.toContain('amount')
    expect(cap.all()).not.toContain('boat')
    expect(cap.all()).not.toContain('48000')
  })

  it('leaves out the optional fields nothing set, rather than writing nulls', () => {
    const cap = capturing()
    logRequest(entry, cap.logger)

    const [written] = cap.entries()
    expect(Object.keys(written ?? {})).not.toContain('rowCount')
    expect(Object.keys(written ?? {})).not.toContain('byteSize')
  })

  it('carries the relay’s two numbers when something set them', () => {
    const cap = capturing()
    logRequest({ ...entry, rowCount: 12, byteSize: 4096 }, cap.logger)

    expect(cap.entries()[0]).toMatchObject({ rowCount: 12, byteSize: 4096 })
  })
})

describe('redaction', () => {
  it('censors the key names that carry a secret, wherever they are logged', () => {
    const cap = capturing()
    cap.logger.error(
      {
        authorization: 'Bearer real-token-value',
        cookie: 'session=real-session-value',
        password: 'hunter2',
        nested: { token: 'real-token', secret: 'real-secret' },
      },
      'something failed',
    )

    const all = cap.all()
    for (const leaked of [
      'real-token-value',
      'real-session-value',
      'hunter2',
      'real-token',
      'real-secret',
    ]) {
      expect(all).not.toContain(leaked)
    }
    expect(all).toContain('[redacted]')
  })
})

describe('the request middleware', () => {
  /** An app shaped like this one: a logged route that reads a body and answers from it. */
  function appWith(logger: ReturnType<typeof capturing>['logger']) {
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', requestLogger(logger))
    app.post('/api/things/:id', async (c) => {
      c.set('userId', 'user-9')
      const body = (await c.req.json()) as { note: string }
      return c.json({ echoed: body.note })
    })
    return app
  }

  it('logs the matched pattern, not the path — so ids in a URL stay out of the log', async () => {
    const cap = capturing()
    await appWith(cap.logger).request('/api/things/6f1c9a2e-dead-beef', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'x' }),
    })

    expect(cap.entries()[0]).toMatchObject({
      route: '/api/things/:id',
      method: 'POST',
      status: 200,
      userId: 'user-9',
    })
    expect(cap.all()).not.toContain('6f1c9a2e-dead-beef')
  })

  it('never writes any part of a request body', async () => {
    const cap = capturing()
    const payload = {
      note: 'Rent for the flat in Prague',
      amount: '-31500.00',
      counterparty: 'Jan Novák',
      iban: 'CZ6508000000192000145399',
    }

    await appWith(cap.logger).request('/api/things/abc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer a-real-session-token',
        cookie: 'better-auth.session_token=a-real-cookie',
      },
      body: JSON.stringify(payload),
    })

    const all = cap.all()
    expect(all).not.toBe('')
    for (const value of Object.values(payload)) {
      expect(all).not.toContain(value)
    }
    for (const key of Object.keys(payload)) {
      expect(all).not.toContain(key)
    }
    expect(all).not.toContain('a-real-session-token')
    expect(all).not.toContain('a-real-cookie')
  })

  it('times the request and reports the status the handler answered with', async () => {
    const cap = capturing()
    const app = new Hono()
    app.use('*', requestLogger(cap.logger))
    app.get('/gone', (c) => c.json({ error: 'TRANSACTION_NOT_FOUND' }, 404))

    await app.request('/gone')

    const [written] = cap.entries()
    expect(written).toMatchObject({ status: 404, userId: null })
    expect(typeof written?.durationMs).toBe('number')
    expect(written?.durationMs as number).toBeGreaterThanOrEqual(0)
  })

  it('logs a request that matched no route without inventing a path for it', async () => {
    const cap = capturing()
    const app = new Hono()
    app.use('*', requestLogger(cap.logger))

    await app.request('/api/does-not-exist/9')

    const [written] = cap.entries()
    expect(written).toMatchObject({ status: 404 })
    expect(cap.all()).not.toContain('does-not-exist')
  })
})

describe('level', () => {
  it('writes nothing below the configured level', () => {
    const cap = capturing('warn')
    logRequest(
      { userId: null, route: '/health', method: 'GET', status: 200, durationMs: 0.1 },
      cap.logger,
    )

    expect(cap.lines).toHaveLength(0)
  })
})

describe('the route a turned-away request names', () => {
  /** The shape of this app: a wildcard auth guard in front of the real routes. */
  function guarded(logger: ReturnType<typeof capturing>['logger']) {
    const app = new Hono()
    app.use('*', requestLogger(logger))
    app.use('/api/*', (c) => c.json({ error: 'UNAUTHORIZED' }, 401))
    app.get('/api/accounts/:id', (c) => c.json({}))
    return app
  }

  it('is the route itself, not the guard that answered for it', async () => {
    const cap = capturing()
    await guarded(cap.logger).request('/api/accounts/6f1c9a2e')

    // `c.req.routePath` would say `/api/*` here, and every 401 would look the same.
    expect(cap.entries()[0]).toMatchObject({ route: '/api/accounts/:id', status: 401 })
    expect(cap.all()).not.toContain('6f1c9a2e')
  })
})

describe('a request that throws', () => {
  it('is still logged, with the status the error handler answered with', async () => {
    const cap = capturing()
    const app = new Hono()
    app.use('*', requestLogger(cap.logger))
    app.get('/boom', () => {
      throw new Error('kaboom')
    })

    const res = await app.request('/boom')

    expect(res.status).toBe(500)
    expect(cap.entries()[0]).toMatchObject({ route: '/boom', status: 500 })
  })
})
