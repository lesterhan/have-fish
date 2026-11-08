// Where a seeded ledger lives, and the ways it's written, kept and brought back. Each profile
// gets a folder standing in for a home: the app finds its ledger there through XDG_DATA_HOME and
// XDG_CONFIG_HOME, as the e2e tests point it at theirs, so nothing touches the real ledger.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { type Ledger, openLedger } from '../../main/db/ledger'
import { MIGRATIONS } from '../../main/db/migrations'
import { readOrCreateInstallId } from '../../main/install-id'
import { applyLocal } from '../../main/ledger/apply'
import { getDocument } from '../../main/ledger/store'
import type { Book } from './book'

/** `desktop/`, from this file in tools/seed/ or from its bundle in out/seed/. */
export const DESKTOP = fileURLToPath(new URL('../..', import.meta.url))

const LEDGER = 'ledger.sqlite'
const APP = 'have-fish'
const DEV_APP = 'have-fish-dev'

export type Where = {
  /** The folder holding the guide, seed.json and snapshots. */
  root: string
  /** XDG_DATA_HOME and XDG_CONFIG_HOME for the app. */
  env: { XDG_DATA_HOME: string; XDG_CONFIG_HOME: string }
  /** The ledger's folder and the app's settings folder, for the packaged app's name. */
  data: string
  config: string
  real: boolean
}

/** A profile's test folder under `desktop/.sandbox/`. */
export function sandbox(profile: string, base = join(DESKTOP, '.sandbox')): Where {
  const root = join(base, profile)
  const home = join(root, 'home')
  const env = { XDG_DATA_HOME: join(home, 'data'), XDG_CONFIG_HOME: join(home, 'config') }
  return {
    root,
    env,
    data: join(env.XDG_DATA_HOME, APP),
    config: join(env.XDG_CONFIG_HOME, APP),
    real: false,
  }
}

/** The packaged app's own folders: the ledger it opens when started from the desktop. */
export function realFolders(env = process.env): Where {
  const abs = (v: string | undefined, fallback: string) => (v?.startsWith('/') ? v : fallback)
  const data = abs(env.XDG_DATA_HOME, join(homedir(), '.local', 'share'))
  const config = abs(env.XDG_CONFIG_HOME, join(homedir(), '.config'))
  return {
    root: join(DESKTOP, '.sandbox', 'real'),
    env: { XDG_DATA_HOME: data, XDG_CONFIG_HOME: config },
    data: join(data, APP),
    config: join(config, APP),
    real: true,
  }
}

export const ledgerPath = (where: Where) => join(where.data, LEDGER)
export const hasLedger = (where: Where) => existsSync(ledgerPath(where))

/** The pid of the app holding `where` open, if one is running. */
export function runningApp(where: Where): number | null {
  for (const name of [APP, DEV_APP]) {
    const lock = join(where.env.XDG_CONFIG_HOME, name, 'SingletonLock')
    let target: string
    try {
      target = readlinkSync(lock)
    } catch {
      continue
    }
    // Chromium writes `<hostname>-<pid>`.
    const pid = Number(target.slice(target.lastIndexOf('-') + 1))
    if (Number.isInteger(pid) && alive(pid)) return pid
  }
  return null
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Makes the folders, with the dev app's names pointing at the packaged app's, so both open it. */
export function prepare(where: Where) {
  mkdirSync(where.root, { recursive: true, mode: 0o700 })
  mkdirSync(where.data, { recursive: true, mode: 0o700 })
  mkdirSync(where.config, { recursive: true, mode: 0o700 })
  if (where.real) return
  for (const base of [where.env.XDG_DATA_HOME, where.env.XDG_CONFIG_HOME]) {
    const dev = join(base, DEV_APP)
    if (!existsSync(dev)) symlinkSync(APP, dev)
  }
}

/** Deletes the ledger file and its WAL, leaving the app's settings and install id. */
export function removeLedger(where: Where) {
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${ledgerPath(where)}${suffix}`, { force: true })
}

/** Opens the ledger as the app would, with this folder's install id. */
export function open(where: Where, now = Date.now()): Ledger {
  const opened = openLedger({
    dir: where.data,
    installId: readOrCreateInstallId(where.config),
    now,
  })
  if (!opened.ok)
    throw new Error(`can't open ${ledgerPath(where)}: ${JSON.stringify(opened.failure)}`)
  return opened.value
}

/** Batches small enough to show progress, and to keep one write's memory bounded. */
const BATCH = 5_000

/**
 * Writes `book` through `applyLocal`, as the app writes: accounts and every transaction's first
 * version, then the fixes and deletions as second versions. `after` leaves out transactions dated
 * on or before it, and accounts already there, for a top-up.
 */
export function write(ledger: Ledger, book: Book, after = '', progress?: (done: number) => void) {
  const accounts = [...book.accounts.values()].filter(
    (a) => getDocument(ledger.db, 'account', a.id) === null,
  )
  const entries = book.entries.filter((e) => e.doc.date > after)
  const first = [...accounts, ...entries.map((e) => e.doc)]
  const second = entries.filter((e) => e.change !== null).map((e) => e.final)
  let done = 0
  for (const docs of [...chunks(first), ...chunks(second)]) {
    const applied = applyLocal(ledger, docs, Date.now())
    if (!applied.ok) {
      const doc = docs[applied.failure.at]
      throw new Error(`refused: ${JSON.stringify(applied.failure)} on ${JSON.stringify(doc)}`)
    }
    done += docs.length
    progress?.(done)
  }
  return { accounts: accounts.length, transactions: entries.length, changes: second.length }
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH))
  return out
}

/** What `seed.json` keeps: enough to build the same ledger again, or carry it forward. */
export type Seeded = { profile: string; seed: string; start: string; today: string }

export const readSeeded = (where: Where): Seeded | null => {
  try {
    return JSON.parse(readFileSync(join(where.root, 'seed.json'), 'utf8'))
  } catch {
    return null
  }
}

export function writeNotes(where: Where, seeded: Seeded, guide: string, tags: string) {
  writeFileSync(join(where.root, 'seed.json'), `${JSON.stringify(seeded, null, 2)}\n`)
  writeFileSync(join(where.root, 'GUIDE.md'), guide)
  writeFileSync(join(where.root, 'tags.json'), tags)
}

const NOTES = ['seed.json', 'GUIDE.md', 'tags.json']
const snapDir = (where: Where, name: string) => join(where.root, 'snaps', name)

/** Keeps the ledger as it is now, copied by SQLite, which reads it whole even while the app writes. */
export function snap(where: Where, name: string) {
  const dir = snapDir(where, name)
  if (existsSync(dir)) throw new Error(`a snapshot called ${name} already exists`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new Database(ledgerPath(where), { readonly: true, fileMustExist: true })
  try {
    db.prepare('VACUUM INTO ?').run(join(dir, LEDGER))
  } finally {
    db.close()
  }
  for (const note of NOTES) copyIfThere(join(where.root, note), join(dir, note))
}

/** Puts a snapshot back in place of the ledger. The app must be closed. */
export function restore(where: Where, name: string) {
  const dir = snapDir(where, name)
  if (!existsSync(join(dir, LEDGER))) throw new Error(`no snapshot called ${name}`)
  removeLedger(where)
  const db = new Database(join(dir, LEDGER), { readonly: true, fileMustExist: true })
  try {
    db.prepare('VACUUM INTO ?').run(ledgerPath(where))
  } finally {
    db.close()
  }
  for (const note of NOTES) copyIfThere(join(dir, note), join(where.root, note))
}

export function snapshots(where: Where): string[] {
  try {
    return readdirSync(join(where.root, 'snaps')).sort()
  } catch {
    return []
  }
}

function copyIfThere(from: string, to: string) {
  if (existsSync(from)) writeFileSync(to, readFileSync(from))
}

/** The packaged app, and whether it knows the newest migration: if not, it refuses the file. */
export function packaged(): { exe: string; stale: boolean } | null {
  const exe = join(DESKTOP, 'dist', 'linux-unpacked', APP)
  const asar = join(DESKTOP, 'dist', 'linux-unpacked', 'resources', 'app.asar')
  if (!existsSync(exe) || !existsSync(asar)) return null
  const newest = MIGRATIONS.at(-1)?.tag ?? ''
  // Electron's Node opens an .asar as a folder unless told not to.
  const electron = process as { noAsar?: boolean | undefined }
  const was = electron.noAsar
  electron.noAsar = true
  try {
    return { exe, stale: !readFileSync(asar).includes(newest) }
  } finally {
    electron.noAsar = was
  }
}
