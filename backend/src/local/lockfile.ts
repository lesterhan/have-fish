// One running instance per data directory (#287, L01). Two processes on one SQLite file would
// each take turns only with themselves (`db/sqlite/client.ts`), so a second launch hands over
// to the first instead of starting.
//
// The lockfile is created exclusively, so of two launches racing only one gets it. It says
// which process holds it and, once that process is listening, its port and launch key; the
// file is the owner's alone, like the directory it is in.

import {
  closeSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'

/** What a running instance publishes for the next launch. */
export type Holder = { pid: number; port: number; launchKey: string }

export type Claim =
  /** This process holds the lock. `publish` says where it listens; `release` gives it up. */
  | { kind: 'claimed'; publish(holder: Holder): void; release(): void }
  /** Another live process holds it and is listening. */
  | { kind: 'running'; holder: Holder }
  /** Another process holds it and has not said where it listens yet. */
  | { kind: 'starting' }

/** Whether a process exists. `EPERM` means it does, and belongs to someone else. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function read(path: string): Partial<Holder> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Holder>) : undefined
  } catch {
    // Missing, or caught between being created and being written.
    return undefined
  }
}

/** An unreadable lockfile this young is most likely one being written right now. */
const WRITING_GRACE_MS = 5000

function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function claimLock(path: string, alive = processAlive): Claim {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number
    try {
      fd = openSync(path, 'wx', 0o600)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const found = read(path)
      if (found?.pid !== undefined && alive(found.pid)) {
        if (found.port !== undefined && found.launchKey !== undefined) {
          return { kind: 'running', holder: found as Holder }
        }
        return { kind: 'starting' }
      }
      if (found === undefined && ageMs(path) < WRITING_GRACE_MS) return { kind: 'starting' }
      // Left by a process that is gone (a crash, a power cut): take it over.
      rmSync(path, { force: true })
      continue
    }

    // The pid goes in on the descriptor that created the file, before anyone else can read it
    // as abandoned.
    writeSync(fd, JSON.stringify({ pid: process.pid }))
    closeSync(fd)
    return {
      kind: 'claimed',
      publish: (holder) => writeFileSync(path, JSON.stringify(holder), { mode: 0o600 }),
      // Only while it is still ours: a lock taken over after this process was presumed dead
      // belongs to someone else now.
      release: () => {
        if (read(path)?.pid === process.pid) rmSync(path, { force: true })
      },
    }
  }
  throw new Error(`could not take the lock at ${path}`)
}
