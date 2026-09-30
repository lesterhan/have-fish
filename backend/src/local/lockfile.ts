// One running instance per data directory (#287, L01). Two processes on one SQLite file would
// each take turns only with themselves (`db/sqlite/client.ts`), so a second launch hands over
// to the first instead of starting.
//
// The lockfile is created exclusively, so of two launches racing only one gets it. It says
// which process holds it and, once that process is listening, its port and launch key; the
// file is the owner's alone, like the directory it is in.
//
// Whether the holder is still there is asked of the holder, not of its pid (#516). A pid means
// something only to a process that sees the same pids, and a Flatpak sandbox does not: every
// `flatpak run` starts in a pid namespace of its own, where the app is pid 2 again. So a
// holder that is listening is asked to prove it holds the launch key, and one that is not
// listening yet is looked up by pid only from inside its own namespace.

import {
  closeSync,
  openSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { randomSecret } from './launch-token'

/** What a running instance publishes for the next launch. */
export type Holder = { pid: number; port: number; launchKey: string }

/**
 * The file itself: the holder, once it has published, plus what only the lock uses. `claim` is
 * this claim's own id, so a release never removes someone else's lock; `pidNs` says which pids
 * `pid` is one of.
 */
type LockContents = Partial<Holder> & { claim?: string; pidNs?: string }

export type Claim =
  /** This process holds the lock. `publish` says where it listens; `release` gives it up. */
  | { kind: 'claimed'; publish(holder: Holder): void; release(): void }
  /** Another instance holds it and answered from where it said it listens. */
  | { kind: 'running'; holder: Holder }
  /** Another process holds it and has not said where it listens yet. */
  | { kind: 'starting' }

/** How the lock finds out whether its holder is still there. */
export type HolderCheck = {
  /**
   * Whether an instance holding `holder.launchKey` answers on `holder.port`. `patient` asks
   * again with longer to answer, for a holder whose pid says it may just be busy.
   */
  answers: (holder: Holder, patient: boolean) => Promise<boolean>
  /** Whether a process exists. Asked only about a pid in this process's own namespace. */
  alive?: (pid: number) => boolean
  /** This process's pid namespace; `pidNamespace()` unless a test says otherwise. */
  namespace?: string | undefined
}

/** Whether a process exists. `EPERM` means it does, and belongs to someone else. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Which pid namespace this process is in, where Linux says; elsewhere there is only one. */
export function pidNamespace(): string | undefined {
  try {
    return readlinkSync('/proc/self/ns/pid')
  } catch {
    return undefined
  }
}

function read(path: string): LockContents | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as LockContents) : undefined
  } catch {
    // Missing, or caught between being created and being written.
    return undefined
  }
}

function published(found: LockContents | undefined): found is LockContents & Holder {
  return (
    typeof found?.pid === 'number' &&
    typeof found.port === 'number' &&
    typeof found.launchKey === 'string'
  )
}

/** An unreadable lockfile this young is most likely one being written right now. */
const WRITING_GRACE_MS = 5000

/**
 * How long a holder in another pid namespace may take to start listening before its lock is
 * taken to be left over from a crash. Starting includes migrating, and copying the ledger
 * first, so this is generous; a live holder publishes long before it runs out.
 */
export const STARTING_GRACE_MS = 30_000

function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export async function claimLock(path: string, check: HolderCheck): Promise<Claim> {
  const alive = check.alive ?? processAlive
  const namespace = 'namespace' in check ? check.namespace : pidNamespace()
  // A lock written before #516, or on a system with one namespace, has none to compare.
  const seesPid = (found: LockContents) =>
    found.pidNs === undefined || namespace === undefined || found.pidNs === namespace

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number
    try {
      fd = openSync(path, 'wx', 0o600)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const found = read(path)
      if (published(found)) {
        const holder = { pid: found.pid, port: found.port, launchKey: found.launchKey }
        if (await check.answers(holder, false)) return { kind: 'running', holder }
        // Its pid is still there, so it may only be busy, or the pid may be someone else's
        // since a reboot. It gets longer to answer, and silence after that means gone.
        if (seesPid(found) && alive(found.pid) && (await check.answers(holder, true))) {
          return { kind: 'running', holder }
        }
      } else if (typeof found?.pid === 'number') {
        if (seesPid(found) ? alive(found.pid) : ageMs(path) < STARTING_GRACE_MS) {
          return { kind: 'starting' }
        }
      } else if (found === undefined && ageMs(path) < WRITING_GRACE_MS) {
        return { kind: 'starting' }
      }
      // Left by an instance that is gone (a crash, a power cut): take it over.
      rmSync(path, { force: true })
      continue
    }

    // The pid goes in on the descriptor that created the file, before anyone else can read it
    // as abandoned.
    const claim = randomSecret()
    const own = { pid: process.pid, pidNs: namespace, claim }
    writeSync(fd, JSON.stringify(own))
    closeSync(fd)
    return {
      kind: 'claimed',
      publish: (holder) =>
        writeFileSync(path, JSON.stringify({ ...holder, pidNs: namespace, claim }), {
          mode: 0o600,
        }),
      // Only while it is still ours: a lock taken over after this process was presumed dead
      // belongs to someone else now, whatever pid it names.
      release: () => {
        if (read(path)?.claim === claim) rmSync(path, { force: true })
      },
    }
  }
  throw new Error(`could not take the lock at ${path}`)
}
