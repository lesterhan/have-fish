// The compiled binary itself (#288): what `bun run build:binary` produced, started twice on a
// data directory of its own. It skips unless HAVEFISH_BINARY names a binary; CI's
// `local-binary` job builds one and sets it, so a dependency that stops embedding, or a
// frontend file that goes missing from the build, fails there rather than on someone's laptop.
// The release workflow (#335) runs it on every binary it publishes, with
// HAVEFISH_BINARY_VERSION set to the version the tag names.

import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Subprocess } from 'bun'

const binary = process.env.HAVEFISH_BINARY

describe.skipIf(!binary)('the compiled binary', () => {
  const home = mkdtempSync(join(tmpdir(), 'havefish-binary-'))
  const data = join(home, '.local', 'share', 'havefish')
  const children: Subprocess[] = []
  afterAll(() => {
    for (const child of children) child.kill()
    rmSync(home, { recursive: true, force: true })
  })

  // Nothing but a home directory: no Bun, no source tree, no node_modules on its path.
  function start() {
    const child = Bun.spawn([resolve(binary ?? '')], {
      cwd: home,
      env: { HOME: home, PATH: '/usr/bin:/bin', HAVEFISH_NO_BROWSER: '1', HAVEFISH_PORT: '47790' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    children.push(child)
    return child
  }

  async function linkFrom(child: Subprocess<'ignore', 'pipe', 'pipe'>): Promise<URL> {
    let seen = ''
    const decoder = new TextDecoder()
    const reader = child.stdout.getReader()
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      seen += decoder.decode(read.value)
      const link = seen.match(/http:\/\/127\.0\.0\.1:\d+\/#token=\S+/)
      if (link) {
        // Nothing more is read: the binary logs to a file, and says nothing else here (#492).
        reader.releaseLock()
        return new URL(link[0])
      }
    }
    throw new Error(`no link; stdout: ${seen}\nstderr: ${await new Response(child.stderr).text()}`)
  }

  async function signIn(link: URL): Promise<string> {
    const res = await fetch(`${link.origin}/api/local/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link.hash.slice('#token='.length) }),
    })
    expect(res.status).toBe(204)
    return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  }

  async function accountIds(origin: string, cookie: string): Promise<string[]> {
    const res = await fetch(`${origin}/api/accounts`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    return ((await res.json()) as { id: string }[]).map((a) => a.id).sort()
  }

  async function stop(child: Subprocess) {
    child.kill('SIGINT')
    expect(await child.exited).toBe(0)
    expect(existsSync(join(data, 'havefish.lock'))).toBe(false)
    const wal = join(data, 'havefish.sqlite-wal')
    expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0)
  }

  it('prints its version and touches nothing', async () => {
    const child = Bun.spawn([resolve(binary ?? ''), '--version'], {
      cwd: home,
      env: { HOME: home, PATH: '/usr/bin:/bin' },
      stdout: 'pipe',
    })
    expect(await child.exited).toBe(0)
    const expected = process.env.HAVEFISH_BINARY_VERSION
    const printed = (await new Response(child.stdout).text()).trim()
    expect(printed).toBe(`havefish ${expected ?? printed.slice('havefish '.length)}`)
    expect(printed).toMatch(/^havefish \S+$/)
    expect(existsSync(data)).toBe(false)
  })

  let firstRun: string[]

  it('starts on an empty home, migrates, and serves the app it carries', async () => {
    const child = start()
    const link = await linkFrom(child)
    const cookie = await signIn(link)
    firstRun = await accountIds(link.origin, cookie)
    expect(firstRun).toHaveLength(3)

    // The document, and every script and stylesheet it names, from inside the binary.
    const html = await (await fetch(`${link.origin}/`)).text()
    expect(html).toStartWith('<!doctype html>')
    const assets = [...html.matchAll(/(?:href|src)="(\/_app\/[^"]+)"/g)].flatMap((m) => m[1] ?? [])
    expect(assets.length).toBeGreaterThan(0)
    const fonts: string[] = []
    for (const asset of assets) {
      const res = await fetch(`${link.origin}${asset}`)
      expect(`${asset} ${res.status}`).toBe(`${asset} 200`)
      if (!asset.endsWith('.css')) continue
      const css = await res.text()
      for (const [, ref] of css.matchAll(/url\(([^)]+\.woff2)\)/g)) {
        fonts.push(new URL(ref as string, `${link.origin}${asset}`).pathname)
      }
    }

    // And every font those stylesheets name, from inside the binary too (#491).
    expect(fonts.length).toBeGreaterThan(0)
    for (const font of fonts) {
      const res = await fetch(`${link.origin}${font}`)
      expect(`${font} ${res.status} ${res.headers.get('content-type')}`).toBe(
        `${font} 200 font/woff2`,
      )
    }
    await stop(child)
  }, 30_000)

  it('finds the same ledger on a second run', async () => {
    const child = start()
    const link = await linkFrom(child)
    expect(await accountIds(link.origin, await signIn(link))).toEqual(firstRun)
    await stop(child)
  }, 30_000)

  it('logs to a file of its own, and outlives a terminal that stops listening (#492)', async () => {
    // `havefish | head -1`: the pipe closes after the first line, before the link is printed.
    const child = Bun.spawn(['sh', '-c', `"$HAVEFISH_BINARY" | head -1`], {
      cwd: home,
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        HAVEFISH_NO_BROWSER: '1',
        HAVEFISH_PORT: '47790',
        HAVEFISH_BINARY: resolve(binary ?? ''),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    children.push(child)
    const origin = 'http://127.0.0.1:47790'
    for (let tries = 0; ; tries++) {
      if ((await fetch(`${origin}/health`).catch(() => null))?.ok) break
      if (tries > 100) throw new Error('the binary never answered behind a closed pipe')
      await Bun.sleep(100)
    }
    for (let i = 0; i < 5; i++) expect((await fetch(`${origin}/health`)).status).toBe(200)

    const log = join(data, 'havefish.log')
    expect(statSync(log).mode & 0o777).toBe(0o600)
    const requests = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((e) => e.msg === 'request' && e.route === '/health')
    expect(requests.length).toBeGreaterThanOrEqual(6)

    // `head` is gone; the binary is not, and still stops cleanly.
    const holder = JSON.parse(readFileSync(join(data, 'havefish.lock'), 'utf8')) as { pid: number }
    process.kill(holder.pid, 'SIGINT')
    for (let tries = 0; existsSync(join(data, 'havefish.lock')); tries++) {
      if (tries > 50) throw new Error('the binary did not give up its lock')
      await Bun.sleep(100)
    }
    // With the binary gone the shell ends too, and what reached the terminal can be read whole.
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe(`have-fish is running at ${origin}\n`)
  }, 30_000)
})
