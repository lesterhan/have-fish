// Where a local build keeps its data (#287, L01): one directory per OS user, per the XDG base
// directory spec on Linux, readable by that user alone.

import { chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * `HAVEFISH_DATA_DIR` when set (a second profile, a test, a portable install); otherwise
 * `$XDG_DATA_HOME/havefish`, which the spec says falls back to `~/.local/share`.
 */
export function dataDirFor(env: NodeJS.ProcessEnv, home = homedir()): string {
  if (env.HAVEFISH_DATA_DIR) return env.HAVEFISH_DATA_DIR
  return join(xdgDataHome(env, home), 'havefish')
}

/**
 * `$XDG_DATA_HOME`, or `~/.local/share` when it is unset. The spec says a relative value is
 * invalid and is to be ignored. The desktop entry and its icon go under it too (#338).
 */
export function xdgDataHome(env: NodeJS.ProcessEnv, home = homedir()): string {
  const xdg = env.XDG_DATA_HOME
  return xdg?.startsWith('/') ? xdg : join(home, '.local', 'share')
}

/** The paths inside it. */
export function dataPaths(dir: string) {
  return {
    database: join(dir, 'havefish.sqlite'),
    lock: join(dir, 'havefish.lock'),
    /** The logger's output (#492); `log-file.ts` rotates it. */
    log: join(dir, 'havefish.log'),
    /** Copies taken before a migration (#288). */
    backups: join(dir, 'backups'),
    /** Where the desktop entry was installed, once it has been (#338). */
    desktopMarker: join(dir, 'desktop-entry'),
  }
}

/**
 * Makes the directory if it is missing, and makes it the owner's alone either way (L07 §3): it
 * holds the whole ledger, and the lockfile holds the key that opens a session on it.
 */
export function prepareDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}
