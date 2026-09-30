// Where the local build's log goes (#492): a file in the data directory, not the terminal.
//
// The terminal is for the person who started the app, and the three lines `announce()` writes
// are all they need; one JSON line per request under them is noise. Started from a desktop
// entry there is no terminal at all, and a crash would leave nothing behind. And stdout is a
// pipe the app can lose: `havefish | head -1` closes it, and the next line written there
// would end the process.
//
// The file is the owner's alone, like the lockfile beside it. It is written synchronously, so
// the line before a crash is on disk rather than in a buffer that died with the process, and
// it is kept to two files of a few MB: checked once at each start, it is moved aside to
// `havefish.log.1` (replacing the one before) once it is past the limit. No pino transport:
// that is a worker thread, and a worker has to survive `bun build --compile`.

import { chmodSync, existsSync, renameSync, statSync } from 'node:fs'
import pino from 'pino'

/** Past this, the log is moved aside at the next start. */
export const ROTATE_AT_BYTES = 5 * 1024 * 1024

/** The file the previous log is kept in. */
export function previousLog(path: string): string {
  return `${path}.1`
}

/** Rotates the log at `path` if it has grown past `rotateAt`, then opens it for appending. */
export function openLogFile(path: string, rotateAt = ROTATE_AT_BYTES): pino.DestinationStream {
  if (existsSync(path) && statSync(path).size >= rotateAt) renameSync(path, previousLog(path))
  const file = pino.destination({ dest: path, sync: true, append: true, mode: 0o600 })
  // `mode` applies only when the file is created; one left from before is narrowed here.
  chmodSync(path, 0o600)
  return file
}

/** The level a local build logs at: `info`, unless `LOG_LEVEL` says otherwise. */
export function localLogLevel(env: NodeJS.ProcessEnv): string {
  return env.LOG_LEVEL || 'info'
}
