// Starting the local build (#287): `HAVEFISH_MODE=local` with `--conditions=sqlite`, or the
// compiled binary (#288), which carries its frontend and migrations inside itself.
//
// In order: find the data directory, take the single-instance lock (or hand over to the
// instance that has it), send the log to a file there (#492), put an adopted ledger in place
// if `--adopt` names one (#289), point the SQLite client at the file, migrate it (copying it
// first if it holds data), find or make the local profile, listen on 127.0.0.1, open the
// browser on a single-use link, and, for the binary, put it in the applications menu (#338).
// Everything that reaches the database is imported only after SQLITE_PATH is set, because the
// client opens its file when it is first imported.

import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { Server } from 'bun'
import type { Migration } from '../db/sqlite/migrate'
import { log, redirectLog } from '../logging'
import { loggedError } from '../request-log'
import { createServer, type Frontend, hasFrontend } from '../server'
import { dataDirFor, dataPaths, prepareDataDir, xdgDataHome } from './data-dir'
import { installDesktopEntry } from './desktop-entry'
import { ANSWER_TIMEOUT_MS, askToQuit, holderAnswers, PATIENT_TIMEOUT_MS } from './holder'
import { mintLaunchToken, randomSecret } from './launch-token'
import { type Claim, claimLock, type Holder, heldBy, STARTING_GRACE_MS } from './lockfile'
import { localLogLevel, openLogFile } from './log-file'

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
function announce(port: number, url: string, opened: boolean, dataDir: string) {
  const lines = [`have-fish is running at http://127.0.0.1:${port}`, `Your ledger is in ${dataDir}`]
  if (!opened) lines.push(`Open it with this link (it works once, for two minutes):`, url)
  process.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * A failure the app cannot carry on from: its stack into the log, and one line on the terminal
 * saying what went wrong and where the rest is. Then the lock goes and the process with it.
 */
function stopOn(e: unknown, logPath: string, release: () => void): never {
  const err = e instanceof Error ? e : new Error(String(e))
  log.fatal({ err: loggedError(err) }, 'stopped')
  process.stderr.write(`have-fish stopped: ${err.message}\nThe log is in ${logPath}\n`)
  release()
  process.exit(1)
}

/**
 * Puts the binary in the applications menu (#338). Never a reason to stop: a read-only home or
 * a missing icon costs the menu entry, and the app runs on regardless.
 */
async function addToMenu(
  executable: string,
  frontend: Frontend,
  env: NodeJS.ProcessEnv,
  marker: string,
): Promise<void> {
  try {
    const iconFile =
      'files' in frontend ? frontend.files.get('/favicon.svg') : join(frontend.root, 'favicon.svg')
    if (!iconFile) throw new Error('the frontend build has no favicon.svg')
    const result = installDesktopEntry({
      executable,
      icon: await Bun.file(iconFile).text(),
      dataHome: xdgDataHome(env),
      marker,
    })
    log.info({ result }, 'desktop entry')
    if (result === 'installed') {
      process.stdout.write(
        'have-fish is in your applications menu now, so you can open it from there\n',
      )
    }
  } catch (e) {
    log.warn(
      { err: loggedError(e instanceof Error ? e : new Error(String(e))) },
      'no desktop entry',
    )
  }
}

/**
 * Whether this launch puts itself in the applications menu (#338). Only the Linux binary has
 * one file to launch. Not for a second profile: the entry would launch without
 * HAVEFISH_DATA_DIR, on the default ledger rather than this one. And not inside a Flatpak
 * (#518), which exports an entry of its own; this one would name a path inside the sandbox.
 */
export function addsItselfToMenu(
  bundle: Pick<LocalBundle, 'executable'>,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): bundle is { executable: string } {
  return (
    bundle.executable !== undefined &&
    !env.HAVEFISH_DATA_DIR &&
    !env.FLATPAK_ID &&
    platform === 'linux'
  )
}

/** The lock, asking the instance it names whether it is there (#516). */
const takeLock = (lockPath: string) =>
  claimLock(lockPath, {
    answers: (holder, patient) =>
      holderAnswers(holder, patient ? PATIENT_TIMEOUT_MS : ANSWER_TIMEOUT_MS),
  })

/**
 * Waits out an instance that holds the lock but is not listening yet. A little longer than a
 * holder in another sandbox is given to start (`STARTING_GRACE_MS`), so one that crashed while
 * starting is waited out and taken over rather than reported.
 */
async function awaitHolder(lockPath: string): Promise<Claim> {
  for (let waited = 0; waited < STARTING_GRACE_MS + 5000; waited += 200) {
    const claim = await takeLock(lockPath)
    if (claim.kind !== 'starting') return claim
    await Bun.sleep(200)
  }
  throw new Error(`another have-fish is starting and has not finished; see ${lockPath}`)
}

/** A version a release stamps: `0.2.0`, `0.2.0-rc.1`. `dev` and anything else is not one. */
const RELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * Whether a build at `mine` should replace a running instance at `theirs` (#517): only when
 * both are releases and `mine` is the newer. An unversioned build never replaces anything and
 * is never replaced, so a development run and an installed one leave each other alone.
 */
export function supersedes(mine: string | undefined, theirs: string | undefined): boolean {
  if (!mine || !theirs || !RELEASE.test(mine) || !RELEASE.test(theirs)) return false
  return Bun.semver.order(mine, theirs) === 1
}

/** How long an older instance gets to fold its WAL back and let go of the lock. */
const REPLACE_WAIT_MS = 10_000

/**
 * Stops an older build that is still running, and takes the lock it lets go of (#517). The
 * wait is for the lock itself, not for the port to go quiet: the old instance stops listening
 * first and closes the database after, and only then is the file this launch's to open. If it
 * will not stop, the claim comes back as it was and this launch hands over, as it always has.
 */
async function replaceOlder(lockPath: string, holder: Holder): Promise<Claim> {
  if (!(await askToQuit(holder))) return { kind: 'running', holder }
  for (let waited = 0; waited < REPLACE_WAIT_MS && heldBy(lockPath, holder); waited += 100) {
    await Bun.sleep(100)
  }
  return takeLock(lockPath)
}

export type LocalBundle = {
  frontend: Frontend
  /** The binary's own; `bun run local` reads them from `drizzle/sqlite` instead. */
  migrations?: Migration[]
  /**
   * The binary's own path, which the desktop entry launches (#338). `bun run local` has no one
   * file to launch, so it passes none and nothing is added to the menu.
   */
  executable?: string
  /** The release this build is, which `supersedes` compares; none for a development run. */
  version?: string
}

/** What the command line can ask for: `--adopt <file>` makes that ledger this install's (#289). */
export function readLaunchArgs(argv: readonly string[]): { adopt: string | null } {
  const { values } = parseArgs({
    args: [...argv],
    options: { adopt: { type: 'string' } },
    strict: false,
  })
  if (values.adopt === true) throw new Error('--adopt needs the path of a ledger file')
  return { adopt: typeof values.adopt === 'string' ? resolve(values.adopt) : null }
}

export async function launchLocal(
  bundle: LocalBundle,
  env = process.env,
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const { adopt } = readLaunchArgs(argv)
  const dir = dataDirFor(env)
  prepareDataDir(dir)
  const paths = dataPaths(dir)

  let claim = await takeLock(paths.lock)
  if (claim.kind === 'starting') claim = await awaitHolder(paths.lock)
  if (claim.kind === 'running' && adopt) {
    // The running instance has the file open; swapping it underneath would lose its writes.
    process.stderr.write('have-fish is running. Quit it first, then adopt the ledger again.\n')
    process.exitCode = 1
    return
  }
  // A newer build replaces an older one still running, so an update takes effect when the app
  // is next opened rather than when someone finds Quit (#517).
  let replaced: string | undefined
  if (claim.kind === 'running' && supersedes(bundle.version, claim.holder.version)) {
    const older = claim.holder.version
    claim = await replaceOlder(paths.lock, claim.holder)
    if (claim.kind === 'claimed') replaced = older
  }
  if (claim.kind === 'running') {
    // A second launch opens a window on the first rather than starting again.
    const url = launchUrl(claim.holder)
    announce(claim.holder.port, url, openBrowser(url, env), dir)
    return
  }
  if (claim.kind !== 'claimed') throw new Error(`unexpected lock state at ${paths.lock}`)
  const lock = claim

  // From here on the terminal hears only what is meant for a person; the rest is in the file.
  // A terminal that goes away (`havefish | head -1`) is not a reason to stop.
  redirectLog(openLogFile(paths.log), localLogLevel(env))
  process.stdout.on('error', () => {})
  const stop = (e: unknown) => stopOn(e, paths.log, lock.release)
  process.on('uncaughtException', stop)
  process.on('unhandledRejection', stop)
  if (replaced) {
    log.info({ from: replaced, to: bundle.version }, 'replaced an older instance')
    process.stdout.write(
      `have-fish ${bundle.version} replaced ${replaced}, which was still running\n`,
    )
  }

  try {
    if (adopt) {
      const { adoptLedger, AdoptRefused } = await import('./adopt-service')
      try {
        const { backup } = await adoptLedger(
          adopt,
          paths,
          bundle.migrations ?? (await import('../db/sqlite/migrate')).readMigrations(),
        )
        const lines = [`Your ledger is now the one from ${adopt}`]
        if (backup) lines.push(`The one that was there before is in ${backup}`)
        process.stdout.write(`${lines.join('\n')}\n`)
      } catch (e) {
        if (!(e instanceof AdoptRefused)) throw e
        process.stderr.write(`Nothing changed: ${e.message}\n`)
        process.exitCode = 1
        lock.release()
        return
      }
    }

    process.env.SQLITE_PATH = paths.database
    const { dialect } = await import('../db')
    if (dialect !== 'sqlite') {
      throw new Error(
        'HAVEFISH_MODE=local needs the SQLite build: run bun with --conditions=sqlite',
      )
    }
    const { migrateSqliteFile, readMigrations, SchemaTooNewError } = await import(
      '../db/sqlite/migrate'
    )
    try {
      const { applied, backup } = await migrateSqliteFile(
        paths.database,
        bundle.migrations ?? readMigrations(),
        { backupDir: paths.backups },
      )
      if (applied.length) log.info({ applied, backup }, 'database migrated')
      if (backup) process.stdout.write(`Copied your ledger to ${backup} before updating it\n`)
    } catch (e) {
      // An older build must not open a newer ledger; say so plainly and leave it alone.
      if (!(e instanceof SchemaTooNewError)) throw e
      process.stderr.write(`${e.message}\n`)
      process.exitCode = 1
      lock.release()
      return
    }

    const { ensureLocalProfile } = await import('./profile-service')
    const { buildApp } = await import('../build-app')
    const { localEdge } = await import('./edge')
    const user = await ensureLocalProfile()

    if (!(await hasFrontend(bundle.frontend))) {
      log.warn('no frontend build found; the local app will serve the API only')
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

    // A clean stop lets requests in flight finish (for a moment, not forever: a browser keeps
    // its connections open), folds the WAL back into the file, and only then gives up the lock.
    // Ctrl-C, the terminal closing, and the titlebar's Quit (#511) all come here.
    const { closeDatabase } = await import('../db')
    let stopping = false
    const quit = async () => {
      if (stopping) return
      stopping = true
      log.info('quitting')
      await Promise.race([server.stop(), Bun.sleep(2000)])
      server.stop(true)
      await closeDatabase()
      lock.release()
      process.exit(0)
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, quit)
    process.on('exit', () => lock.release())

    const edge = localEdge({ port, launchKey, user, quit: () => void quit() })
    handle = (await createServer(buildApp(edge), bundle.frontend)).fetch

    lock.publish({
      pid: process.pid,
      port,
      launchKey,
      ...(bundle.version ? { version: bundle.version } : {}),
    })
    log.info({ port, dataDir: dir }, 'local app listening')

    const url = launchUrl({ port, launchKey })
    announce(port, url, openBrowser(url, env), dir)

    if (addsItselfToMenu(bundle, env)) {
      await addToMenu(bundle.executable, bundle.frontend, env, paths.desktopMarker)
    }
  } catch (e) {
    stop(e)
  }
}
