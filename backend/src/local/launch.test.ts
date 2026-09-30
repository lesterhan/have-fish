// Starting the local build for real (#287's acceptance, less the browser): the entry point in
// a child process, over HTTP on 127.0.0.1, with a data directory of its own.

import { afterAll, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import type { Subprocess } from 'bun'
import { migrateSqliteFile, readMigrations } from '../db/sqlite/migrate'
import { launchUrl, listenOnFreePort, readLaunchArgs } from './launch'

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

describe('readLaunchArgs', () => {
  it('reads --adopt as a path from where the command was run', () => {
    expect(readLaunchArgs(['--adopt', 'you.sqlite'])).toEqual({
      adopt: join(process.cwd(), 'you.sqlite'),
    })
    expect(readLaunchArgs(['--adopt=/tmp/you.sqlite'])).toEqual({ adopt: '/tmp/you.sqlite' })
  })

  it('asks for nothing when given nothing, and says so when --adopt names no file', () => {
    expect(readLaunchArgs([])).toEqual({ adopt: null })
    expect(() => readLaunchArgs(['--adopt'])).toThrow('needs the path')
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
  function launch(conditions: string[] = ['--conditions=sqlite'], args: string[] = []) {
    mkdirSync(site, { recursive: true })
    writeFileSync(join(site, 'index.html'), '<!doctype html><title>have-fish</title>')
    const child = Bun.spawn(['bun', ...conditions, 'src/index.ts', ...args], {
      cwd: BACKEND,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        HAVEFISH_MODE: 'local',
        HAVEFISH_DATA_DIR: data,
        HAVEFISH_NO_BROWSER: '1',
        HAVEFISH_PORT: '47810',
        HAVEFISH_STATIC_ROOT: site,
        // What a person gets by default, so the log file below is the one they would have.
        LOG_LEVEL: 'info',
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
  let firstCookie: string

  it('starts, makes its data directory, and prints a link that signs the page in', async () => {
    first = launch()
    firstLink = await linkFrom(first)
    expect(firstLink.origin).toBe('http://127.0.0.1:47810')
    expect(existsSync(join(data, 'havefish.sqlite'))).toBe(true)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(true)

    firstCookie = await open(firstLink)
    const accounts = await fetch(`${firstLink.origin}/api/accounts`, {
      headers: { Cookie: firstCookie },
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

  it('will not adopt a ledger while it is running', async () => {
    const adopting = launch(undefined, ['--adopt', join(root, 'anything.sqlite')])
    expect(await adopting.exited).toBe(1)
    expect(await new Response(adopting.stderr).text()).toContain('Quit it first')
  }, 20_000)

  it('folds the WAL into the file and gives up the lock when stopped', async () => {
    first.kill('SIGINT')
    expect(await first.exited).toBe(0)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
    const wal = join(data, 'havefish.sqlite-wal')
    expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0)
  }, 20_000)

  it('told its terminal only what was meant for a person, and logged the rest to a file (#492)', async () => {
    // Everything after the link: the requests above wrote nothing more to the terminal.
    const reader = first.stdout.getReader()
    let rest = ''
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      rest += new TextDecoder().decode(read.value)
    }
    expect(rest).toBe('')
    expect(await new Response(first.stderr).text()).toBe('')

    const path = join(data, 'havefish.log')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const text = readFileSync(path, 'utf8')
    const entries = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const routes = entries.filter((e) => e.msg === 'request').map((e) => e.route)
    expect(routes).toContain('/api/local/session')
    expect(routes).toContain('/api/accounts')
    expect(entries.some((e) => e.msg === 'local app listening')).toBe(true)
    // Neither the link's token nor the session it bought.
    expect(text).not.toContain(firstLink.hash.slice('#token='.length))
    expect(text).not.toContain(firstCookie.split('=')[1] ?? firstCookie)
  })

  it('refuses a ledger a newer build has migrated, and leaves it alone', async () => {
    const client = createClient({ url: `file:${join(data, 'havefish.sqlite')}` })
    await client.execute("INSERT INTO __migrations VALUES ('9999_from_the_future', 0)")
    client.close()

    const older = launch()
    expect(await older.exited).toBe(1)
    expect(await new Response(older.stderr).text()).toContain('newer have-fish')
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
    expect(existsSync(join(data, 'backups'))).toBe(false)

    const again = createClient({ url: `file:${join(data, 'havefish.sqlite')}` })
    await again.execute("DELETE FROM __migrations WHERE name = '9999_from_the_future'")
    again.close()
  }, 20_000)

  it('adopts a ledger named on the command line, and starts on it (#289)', async () => {
    // A ledger as the export writes one: an owner, its profile, and an account of its own.
    const source = join(root, 'yours.sqlite')
    await migrateSqliteFile(source, readMigrations())
    const client = createClient({ url: `file:${source}` })
    const you = crypto.randomUUID()
    await client.batch([
      {
        sql: "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'You', 'you@example.com', 1, 0, 0)",
        args: [you],
      },
      { sql: 'INSERT INTO local_profile (user_id, created_at) VALUES (?, 0)', args: [you] },
      {
        sql: "INSERT INTO accounts (id, user_id, path, path_key, created_at, updated_at) VALUES (?, ?, 'assets:brought:over', 'assets:brought:over', 0, 0)",
        args: [crypto.randomUUID(), you],
      },
    ])
    client.close()

    const adopted = launch(undefined, ['--adopt', source])
    const link = await linkFrom(adopted)
    const accounts = await fetch(`${link.origin}/api/accounts`, {
      headers: { Cookie: await open(link) },
    })
    expect(((await accounts.json()) as { path: string }[]).map((a) => a.path)).toEqual([
      'assets:brought:over',
    ])
    // The fresh install it replaced, which had no transactions, is kept.
    expect(readdirSync(join(data, 'backups')).some((f) => f.startsWith('pre-adopt-'))).toBe(true)
    adopted.kill('SIGINT')
    expect(await adopted.exited).toBe(0)
  }, 20_000)

  it('quits from the app the way it quits on Ctrl-C (#511)', async () => {
    const running = launch()
    const link = await linkFrom(running)
    const res = await fetch(`${link.origin}/api/local/quit`, {
      method: 'POST',
      headers: { Cookie: await open(link) },
    })
    expect(res.status).toBe(202)
    expect(await running.exited).toBe(0)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
    const wal = join(data, 'havefish.sqlite-wal')
    expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0)
    // Nothing is listening: the next launch starts afresh rather than handing over.
    await expect(fetch(`${link.origin}/health`)).rejects.toThrow()
  }, 20_000)

  it('quits cleanly when the terminal it was started from closes', async () => {
    const running = launch()
    await linkFrom(running)
    running.kill('SIGHUP')
    expect(await running.exited).toBe(0)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
  }, 20_000)

  it('refuses to start from the Postgres build', async () => {
    const pg = launch([])
    expect(await pg.exited).not.toBe(0)
    const said = await new Response(pg.stderr).text()
    expect(said).toContain('needs the SQLite build')
    // The terminal gets the reason in a line and where to look; the stack is in the file.
    expect(said).toContain(`The log is in ${join(data, 'havefish.log')}`)
    expect(said).not.toContain('    at ')
    expect(readFileSync(join(data, 'havefish.log'), 'utf8')).toContain('needs the SQLite build')
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
  }, 20_000)
})
