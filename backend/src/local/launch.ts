// Starting the local build (#287): `HAVEFISH_MODE=local`, with `--conditions=sqlite`.
//
// In order: find the data directory, take the single-instance lock (or hand over to the
// instance that has it), point the SQLite client at the file, migrate it, find or make the
// local profile, listen on 127.0.0.1, and open the browser on a single-use link. Everything
// that reaches the database is imported only after SQLITE_PATH is set, because the client
// opens its file when it is first imported.

import type { Server } from 'bun'
import { log } from '../logging'
import { createServer, hasFrontend } from '../server'
import { dataDirFor, dataPaths, prepareDataDir } from './data-dir'
import { mintLaunchToken, randomSecret } from './launch-token'
import { type Claim, claimLock, type Holder } from './lockfile'

/** The first port tried; the next few are tried after it (L01: a fixed port with a fallback). */
export const DEFAULT_PORT = 47821
const PORTS_TRIED = 10

/** Binds the first free port from `first` on, on the loopback interface only (L07 §1). */
export function listenOnFreePort(
  first: number,
  tries: number,
  fetch: (req: Request) => Response | Promise<Response>,
): Server<undefined> {
  for (let port = first; port < first + tries; port++) {
    try {
      return Bun.serve({ hostname: '127.0.0.1', port, fetch })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') continue
      throw e
    }
  }
  throw new Error(`ports ${first} to ${first + tries - 1} on 127.0.0.1 are all in use`)
}

/** The link that opens the app: the token rides in the fragment, which is never sent. */
export function launchUrl(holder: Pick<Holder, 'port' | 'launchKey'>): string {
  return `http://127.0.0.1:${holder.port}/#token=${mintLaunchToken(holder.launchKey)}`
}

/** Opens `url` in the default browser, or says why it could not. */
function openBrowser(url: string, env: NodeJS.ProcessEnv): boolean {
  if (env.HAVEFISH_NO_BROWSER) return false
  try {
    Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Tells the person at the terminal where the app is. Not through the logger: the link carries
 * a token, and a log line is kept. It goes to the terminal only when no browser was opened.
 */
function announce(port: number, url: string, opened: boolean) {
  const lines = [`have-fish is running at http://127.0.0.1:${port}`]
  if (!opened) lines.push(`Open it with this link (it works once, for two minutes):`, url)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** Waits out an instance that holds the lock but is not listening yet. */
async function awaitHolder(lockPath: string): Promise<Claim> {
  for (let waited = 0; waited < 10_000; waited += 200) {
    const claim = claimLock(lockPath)
    if (claim.kind !== 'starting') return claim
    await Bun.sleep(200)
  }
  throw new Error(`another have-fish is starting and has not finished; see ${lockPath}`)
}

export async function launchLocal(staticRoot: string, env = process.env): Promise<void> {
  const dir = dataDirFor(env)
  prepareDataDir(dir)
  const paths = dataPaths(dir)

  let claim = claimLock(paths.lock)
  if (claim.kind === 'starting') claim = await awaitHolder(paths.lock)
  if (claim.kind === 'running') {
    // A second launch opens a window on the first rather than starting again.
    const url = launchUrl(claim.holder)
    announce(claim.holder.port, url, openBrowser(url, env))
    return
  }
  if (claim.kind !== 'claimed') throw new Error(`unexpected lock state at ${paths.lock}`)
  const lock = claim

  try {
    process.env.SQLITE_PATH = paths.database
    const { dialect } = await import('../db')
    if (dialect !== 'sqlite') {
      throw new Error(
        'HAVEFISH_MODE=local needs the SQLite build: run bun with --conditions=sqlite',
      )
    }
    const { migrateSqliteFile } = await import('../db/sqlite/migrate')
    await migrateSqliteFile(paths.database)

    const { ensureLocalProfile } = await import('./profile-service')
    const { buildApp } = await import('../build-app')
    const { localEdge } = await import('./edge')
    const user = await ensureLocalProfile()

    if (!(await hasFrontend(staticRoot))) {
      log.warn({ staticRoot }, 'no frontend build found; the local app will serve the API only')
    }

    // The edge's Host check needs the port, and the port is known only once bound, so the
    // server starts on a stand-in and is handed the real app straight after.
    const launchKey = randomSecret()
    let handle: (req: Request) => Response | Promise<Response> = () =>
      new Response(null, { status: 503 })
    const server = listenOnFreePort(Number(env.HAVEFISH_PORT ?? DEFAULT_PORT), PORTS_TRIED, (req) =>
      handle(req),
    )
    const port = server.port ?? DEFAULT_PORT
    handle = (await createServer(buildApp(localEdge({ port, launchKey, user })), staticRoot)).fetch

    lock.publish({ pid: process.pid, port, launchKey })
    log.info({ port, dataDir: dir }, 'local app listening')

    const stop = () => {
      server.stop()
      lock.release()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    process.on('exit', () => lock.release())

    const url = launchUrl({ port, launchKey })
    announce(port, url, openBrowser(url, env))
  } catch (e) {
    lock.release()
    throw e
  }
}
