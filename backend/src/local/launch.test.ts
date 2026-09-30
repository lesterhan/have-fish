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
import { addsItselfToMenu, launchUrl, listenOnFreePort, readLaunchArgs, supersedes } from './launch'
import { pidNamespace } from './lockfile'

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

describe('supersedes', () => {
  it('replaces an older release with a newer one, and nothing else', () => {
    expect(supersedes('0.2.0', '0.1.0')).toBe(true)
    expect(supersedes('0.10.0', '0.9.3')).toBe(true)
    expect(supersedes('0.2.0', '0.2.0-rc.1')).toBe(true)
    expect(supersedes('0.2.0-rc.2', '0.2.0-rc.1')).toBe(true)
    expect(supersedes('0.1.0', '0.1.0')).toBe(false)
    expect(supersedes('0.1.0', '0.2.0')).toBe(false)
  })

  it('leaves an unversioned build alone, either way round', () => {
    for (const [mine, theirs] of [
      ['dev', '0.1.0'],
      ['0.2.0', 'dev'],
      [undefined, '0.1.0'],
      ['0.2.0', undefined],
      ['v0.2.0', '0.1.0'],
      ['0.2', '0.1.0'],
    ] as const) {
      expect(supersedes(mine, theirs)).toBe(false)
    }
  })
})

describe('addsItselfToMenu', () => {
  const binary = { executable: '/home/me/havefish' }

  it('is the Linux binary on its default ledger', () => {
    expect(addsItselfToMenu(binary, {}, 'linux')).toBe(true)
  })

  it('is not `bun run local`, which has no one file to launch', () => {
    expect(addsItselfToMenu({}, {}, 'linux')).toBe(false)
  })

  it('is not a second profile, whose entry would open the default ledger', () => {
    expect(addsItselfToMenu(binary, { HAVEFISH_DATA_DIR: '/tmp/other' }, 'linux')).toBe(false)
  })

  // Flatpak exports the entry in flatpak/; one written from inside would name /app/bin (#518).
  it('is not the Flatpak', () => {
    expect(addsItselfToMenu(binary, { FLATPAK_ID: 'com.lesterhan.havefish' }, 'linux')).toBe(false)
  })

  it('is not another system', () => {
    expect(addsItselfToMenu(binary, {}, 'darwin')).toBe(false)
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
  // `inside` runs it inside something first: a sandbox, for #516.
  function launch(
    conditions: string[] = ['--conditions=sqlite'],
    args: string[] = [],
    inside: string[] = [],
    extraEnv: Record<string, string> = {},
  ) {
    mkdirSync(site, { recursive: true })
    writeFileSync(join(site, 'index.html'), '<!doctype html><title>have-fish</title>')
    const child = Bun.spawn([...inside, 'bun', ...conditions, 'src/index.ts', ...args], {
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
        ...extraEnv,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    children.push(child)
    return child
  }

  /** What the last `linkFrom` read from the terminal, up to and including the link. */
  let printed = ''

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
        printed = seen
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

  // #516: a pid that is alive says nothing about an instance that is not answering. Here the
  // pid is this test's own, and the port it names has nothing on it.
  it('takes over a lock whose holder does not answer, even when its pid is alive', async () => {
    writeFileSync(
      join(data, 'havefish.lock'),
      JSON.stringify({ pid: process.pid, pidNs: pidNamespace(), port: 47_809, launchKey: 'gone' }),
    )
    const running = launch()
    const link = await linkFrom(running)
    expect(link.origin).toBe('http://127.0.0.1:47810')
    await open(link)
    running.kill('SIGINT')
    expect(await running.exited).toBe(0)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
  }, 30_000)

  // #516 as Flatpak has it: each launch in a pid namespace of its own, where it is pid 2.
  // bubblewrap is what `flatpak run` uses; where it is missing or may not make a namespace (CI's
  // runner), the lock's own tests cover the rule with the namespace given to them.
  // `--die-with-parent`, as `flatpak run` passes it, so killing bwrap kills what is inside.
  const sandbox = [
    'bwrap',
    '--unshare-pid',
    '--die-with-parent',
    '--dev-bind',
    '/',
    '/',
    '--proc',
    '/proc',
  ]
  const canSandbox =
    Bun.which('bwrap') !== null && Bun.spawnSync([...sandbox, 'true']).exitCode === 0

  it.skipIf(!canSandbox)(
    'hands over and takes over across sandboxes, as pid 2 each time',
    async () => {
      const first = launch(undefined, [], sandbox)
      const firstLink = await linkFrom(first)
      expect(contentsOfLock().pid).toBe(2)

      const second = launch(undefined, [], sandbox)
      const secondLink = await linkFrom(second)
      expect(await second.exited).toBe(0)
      expect(secondLink.origin).toBe(firstLink.origin)
      await open(secondLink)

      // A crash: the lock stays behind, naming pid 2 and a port nothing will answer on.
      first.kill('SIGKILL')
      await first.exited
      await expect(fetch(`${firstLink.origin}/health`)).rejects.toThrow()
      expect(contentsOfLock().pid).toBe(2)

      // Before #516 this launch saw pid 2 alive (itself), handed over to the dead port, and exited.
      const third = launch(undefined, [], sandbox)
      const thirdLink = await linkFrom(third)
      const cookie = await open(thirdLink)
      expect(third.exitCode).toBeNull()
      expect(contentsOfLock().pid).toBe(2)

      // A signal to bwrap is not one to the app, so it quits the way the titlebar quits it.
      const quit = await fetch(`${thirdLink.origin}/api/local/quit`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
      expect(quit.status).toBe(202)
      expect(await third.exited).toBe(0)
      expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
    },
    60_000,
  )

  function contentsOfLock(): { pid: number; version?: string } {
    return JSON.parse(readFileSync(join(data, 'havefish.lock'), 'utf8')) as { pid: number }
  }

  it('replaces an older release that is still running, and nothing else (#517)', async () => {
    const older = launch(undefined, [], [], { PUBLIC_VERSION: '0.1.0' })
    const olderLink = await linkFrom(older)
    expect(contentsOfLock().version).toBe('0.1.0')

    // The update: a newer build opened from the menu while the old one is still up.
    const newer = launch(undefined, [], [], { PUBLIC_VERSION: '0.2.0' })
    const newerLink = await linkFrom(newer)
    expect(printed).toContain('have-fish 0.2.0 replaced 0.1.0, which was still running')
    expect(await older.exited).toBe(0)
    expect(newer.exitCode).toBeNull()
    expect(contentsOfLock().version).toBe('0.2.0')
    expect(newerLink.origin).toBe(olderLink.origin)
    const cookie = await open(newerLink)

    // An older build, and one with no version at all, hand over to it as before.
    for (const env of [{ PUBLIC_VERSION: '0.1.0' }, {}]) {
      const later = launch(undefined, [], [], env)
      const link = await linkFrom(later)
      expect(await later.exited).toBe(0)
      expect(link.origin).toBe(newerLink.origin)
      expect(printed).not.toContain('replaced')
    }
    expect(newer.exitCode).toBeNull()

    const quit = await fetch(`${newerLink.origin}/api/local/quit`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(quit.status).toBe(202)
    expect(await newer.exited).toBe(0)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
  }, 60_000)

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
