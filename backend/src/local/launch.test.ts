// Starting the local build for real (#287's acceptance, less the browser): the entry point in
// a child process, over HTTP on 127.0.0.1, with a data directory of its own.

import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { launchUrl, listenOnFreePort } from './launch'

const BACKEND = join(import.meta.dir, '../..')

describe('listenOnFreePort', () => {
  it('moves past a port that is taken, on the loopback interface only', () => {
    const taken = listenOnFreePort(47_700, 20, () => new Response('first'))
    const next = listenOnFreePort(taken.port ?? 0, 20, () => new Response('second'))
    try {
      expect(next.port).toBe((taken.port ?? 0) + 1)
      expect(next.hostname).toBe('127.0.0.1')
    } finally {
      taken.stop(true)
      next.stop(true)
    }
  })

  it('says so when every port it may try is taken', () => {
    const taken = listenOnFreePort(47_750, 20, () => new Response('first'))
    try {
      expect(() => listenOnFreePort(taken.port ?? 0, 1, () => new Response('x'))).toThrow('in use')
    } finally {
      taken.stop(true)
    }
  })
})

describe('launchUrl', () => {
  it('puts the token in the fragment, which the browser never sends', () => {
    const url = new URL(launchUrl({ port: 47821, launchKey: 'k' }))
    expect(url.origin).toBe('http://127.0.0.1:47821')
    expect(url.pathname).toBe('/')
    expect(url.search).toBe('')
    expect(url.hash).toStartWith('#token=')
  })
})

describe('HAVEFISH_MODE=local', () => {
  const root = mkdtempSync(join(tmpdir(), 'havefish-launch-'))
  const data = join(root, 'data')
  const site = join(root, 'site')
  const children: Subprocess[] = []
  afterAll(() => {
    for (const child of children) child.kill()
    rmSync(root, { recursive: true, force: true })
  })

  // The child is started the way `bun run local` starts it, and never opens a browser.
  function launch(conditions: string[] = ['--conditions=sqlite']) {
    mkdirSync(site, { recursive: true })
    writeFileSync(join(site, 'index.html'), '<!doctype html><title>have-fish</title>')
    const child = Bun.spawn(['bun', ...conditions, 'src/index.ts'], {
      cwd: BACKEND,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        HAVEFISH_MODE: 'local',
        HAVEFISH_DATA_DIR: data,
        HAVEFISH_NO_BROWSER: '1',
        HAVEFISH_PORT: '47810',
        HAVEFISH_STATIC_ROOT: site,
        LOG_LEVEL: 'silent',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    children.push(child)
    return child
  }

  /** Reads the child's terminal until it prints the link, and returns it. */
  async function linkFrom(child: Subprocess<'ignore', 'pipe', 'pipe'>): Promise<URL> {
    let seen = ''
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      seen += decoder.decode(value)
      const link = seen.match(/http:\/\/127\.0\.0\.1:\d+\/#token=\S+/)
      if (link) {
        reader.releaseLock()
        return new URL(link[0])
      }
    }
    throw new Error(
      `no link printed; stdout was: ${seen}\nstderr: ${await new Response(child.stderr).text()}`,
    )
  }

  async function open(link: URL): Promise<string> {
    const token = link.hash.slice('#token='.length)
    const res = await fetch(`${link.origin}/api/local/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(204)
    return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  }

  let first: Subprocess<'ignore', 'pipe', 'pipe'>
  let firstLink: URL

  it('starts, makes its data directory, and prints a link that signs the page in', async () => {
    first = launch()
    firstLink = await linkFrom(first)
    expect(firstLink.origin).toBe('http://127.0.0.1:47810')
    expect(existsSync(join(data, 'havefish.sqlite'))).toBe(true)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(true)

    const cookie = await open(firstLink)
    const accounts = await fetch(`${firstLink.origin}/api/accounts`, {
      headers: { Cookie: cookie },
    })
    expect(accounts.status).toBe(200)
    expect(((await accounts.json()) as unknown[]).length).toBe(3)
    const page = await fetch(`${firstLink.origin}/accounts`)
    expect(await page.text()).toContain('<title>have-fish</title>')
  }, 20_000)

  it('hands a second launch over to the first, with a fresh link of its own', async () => {
    const second = launch()
    const link = await linkFrom(second)
    expect(await second.exited).toBe(0)
    expect(link.origin).toBe(firstLink.origin)
    expect(link.hash).not.toBe(firstLink.hash)
    await open(link)
  }, 20_000)

  it('gives up the lock when stopped', async () => {
    first.kill('SIGTERM')
    await first.exited
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
  }, 20_000)

  it('refuses to start from the Postgres build', async () => {
    const pg = launch([])
    expect(await pg.exited).not.toBe(0)
    expect(await new Response(pg.stderr).text()).toContain('needs the SQLite build')
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
  }, 20_000)
})
