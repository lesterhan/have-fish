import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { app } from './app'
import { createServer, type Frontend, hasFrontend } from './server'

// A stand-in for a SvelteKit build: the document, a hashed asset, and one file named after
// an API route so the shadowing test has something to shadow with.
function buildDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'havefish-static-'))
  mkdirSync(join(dir, '_app', 'immutable'), { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>shell</title>')
  writeFileSync(join(dir, '_app', 'immutable', 'entry.abc123.js'), 'export const x = 1')
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  // If static files were reachable before the API, this would answer /health.
  writeFileSync(join(dir, 'health'), 'STATIC FILE, NOT THE API')
  return dir
}

// The same build as a compiled binary carries it (#288): each file by the path it is served at.
function embeddedFrom(dir: string): Frontend {
  const files = new Map<string, string>()
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (statSync(join(dir, rel)).isFile()) files.set(`/${rel}`, join(dir, rel))
  }
  return { files }
}

const FRONTENDS: [string, (dir: string) => Frontend][] = [
  ['from a folder', (root) => ({ root })],
  ['embedded in the binary', embeddedFrom],
]

const get = (server: Hono, path: string) => server.fetch(new Request(`http://localhost${path}`))

describe.each(FRONTENDS)('with a frontend build present, %s', (_, frontendOf) => {
  let dir: string
  let server: Hono

  beforeAll(async () => {
    dir = buildDir()
    server = await createServer(app, frontendOf(dir))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('serves the document at the root', async () => {
    const res = await get(server, '/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>shell</title>')
  })

  it('serves an unknown path as the document, because the client router owns it', async () => {
    for (const path of ['/accounts', '/fish-pie/abc/settings', '/import']) {
      const res = await get(server, path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('shell')
    }
  })

  it('serves a build asset as itself, with a JavaScript content type', async () => {
    const res = await get(server, '/_app/immutable/entry.abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(await res.text()).toBe('export const x = 1')
  })

  // A stale document asking for a chunk that no longer exists must be told it is gone.
  // Answering with the shell and a 200 makes the browser's module loader fail on
  // `Unexpected token '<'`, which says nothing about what actually happened.
  it('answers a missing build asset with 404, not the document', async () => {
    const res = await get(server, '/_app/immutable/gone.xyz789.js')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('shell')
  })

  it('serves each asset with its own content type', async () => {
    const res = await get(server, '/favicon.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/svg+xml')
  })

  it('never serves a file from outside the build', async () => {
    for (const path of ['/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd']) {
      const body = await (await get(server, path)).text()
      expect(body).not.toContain('root:')
    }
  })

  // The whole point of mounting the API first.
  it('lets no static file shadow an API route', async () => {
    const res = await get(server, '/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('does not answer an unknown /api path with the document', async () => {
    const res = await get(server, '/api/definitely-not-a-route')
    const body = await res.text()
    expect(body).not.toContain('shell')
    expect(res.status).not.toBe(200)
  })
})

describe('with no frontend build', () => {
  let dir: string
  let server: Hono

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'havefish-empty-'))
    server = await createServer(app, { root: dir })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('still serves the API', async () => {
    const res = await get(server, '/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  // A dev run, where Vite serves the frontend. Falling back to a document that is not
  // there would be worse than saying so.
  it('does not invent a document', async () => {
    expect((await get(server, '/')).status).toBe(404)
    expect((await get(server, '/accounts')).status).toBe(404)
  })
})

describe('hasFrontend', () => {
  it('is true when index.html is there and false when it is not', async () => {
    const dir = buildDir()
    const empty = mkdtempSync(join(tmpdir(), 'havefish-empty-'))
    try {
      expect(await hasFrontend({ root: dir })).toBe(true)
      expect(await hasFrontend({ root: empty })).toBe(false)
      expect(await hasFrontend(embeddedFrom(dir))).toBe(true)
      expect(await hasFrontend(embeddedFrom(empty))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
