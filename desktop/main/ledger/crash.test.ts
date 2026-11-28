import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Ledger, openLedger } from '../db/ledger'
import { ok } from './fixtures'

const KILLS = 12
const BATCH = 40
const INSTALL = 'crash'
const DESKTOP = join(import.meta.dirname, '..', '..')

type Killed = {
  signal: NodeJS.Signals | null
  told: number[]
  walBytes: number
  ledger: Ledger
}

/** Every writer started, so `afterAll` can stop any a failure left running. */
const children = new Set<ChildProcess>()

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null

/** Kills a writer's process group; one already gone is no failure. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'ESRCH')) throw e
  }
}

/** Waits until `saved` holds `lines` told batches, or throws `why` after 20 s. */
async function untilTold(saved: string, lines: number, why: string): Promise<void> {
  const started = Date.now()
  while (!(existsSync(saved) && readFileSync(saved, 'utf8').split('\n').length > lines)) {
    if (Date.now() - started > 20_000) throw new Error(why)
    await setTimeout(5)
  }
}

/** Runs a writer into `dir`, kills its process group at a random moment, and opens what it left. */
async function killOne(writer: string, dir: string): Promise<Killed> {
  const child = spawn(process.execPath, [writer, dir, INSTALL, String(BATCH)], {
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  children.add(child)
  const { pid } = child
  if (pid === undefined) throw new Error('the writer did not start')
  const exited = new Promise<NodeJS.Signals | null>((resolve) =>
    child.once('exit', (_, signal) => resolve(signal)),
  )
  const saved = join(dir, 'saved')
  try {
    await untilTold(saved, 1, 'the writer told no batch')
    await untilTold(saved, 2, 'the writer told no second batch')
    await setTimeout(Math.random() * 400)
    killGroup(pid)
    const signal = await exited
    const text = readFileSync(saved, 'utf8')
    const told = text.slice(0, text.lastIndexOf('\n')).split('\n').map(Number)
    const walBytes = statSync(join(dir, 'ledger.sqlite-wal')).size
    const ledger = ok(openLedger({ dir, installId: INSTALL, now: Date.now() }))
    return { signal, told, walBytes, ledger }
  } finally {
    if (running(child)) killGroup(pid)
  }
}

let root: string
let killed: Killed[] = []

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'havefish-crash-'))
  const writer = join(root, 'writer.mjs')
  const built = spawnSync(
    'bun',
    [
      'build',
      join(import.meta.dirname, 'crash-writer.ts'),
      '--target=node',
      '--format=esm',
      '--external=better-sqlite3',
      `--outfile=${writer}`,
    ],
    { encoding: 'utf8' },
  )
  if (built.status !== 0) throw new Error(built.stderr)
  // The bundle finds better-sqlite3 beside it.
  symlinkSync(join(DESKTOP, 'node_modules'), join(root, 'node_modules'))
  // Every kill settles first, so the ledgers that did open are kept for `afterAll` to close.
  const settled = await Promise.allSettled(
    Array.from({ length: KILLS }, (_, i) => killOne(writer, join(root, `ledger-${i}`))),
  )
  killed = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
  const failed = settled.find((s) => s.status === 'rejected')
  if (failed !== undefined) throw failed.reason
}, 60_000)

afterAll(async () => {
  for (const child of children) {
    if (!running(child) || child.pid === undefined) continue
    const exit = once(child, 'exit')
    killGroup(child.pid)
    await exit
  }
  for (const { ledger } of killed) ledger.close()
  rmSync(root, { recursive: true, force: true })
})

describe('a ledger whose writer is killed mid-write', () => {
  it('each writer was killed by SIGKILL while writing, with a batch told and frames in the WAL', () => {
    expect(killed).toHaveLength(KILLS)
    for (const { signal, told, walBytes } of killed) {
      expect(signal).toBe('SIGKILL')
      expect(told.length).toBeGreaterThan(1)
      expect(walBytes).toBeGreaterThan(0)
    }
  })

  it('every file it leaves passes integrity_check', () => {
    for (const { ledger } of killed) {
      expect(ledger.db.pragma('integrity_check', { simple: true })).toBe('ok')
    }
  })

  it('every batch in a file has all 40 of its spends', () => {
    for (const { ledger } of killed) {
      const counts = ledger.db
        .prepare('SELECT count(*) FROM transactions GROUP BY description')
        .pluck()
        .all()
      expect(counts).not.toEqual([])
      expect(counts.filter((count) => count !== BATCH)).toEqual([])
    }
  })

  it('every batch the writer was told was saved is in its file', () => {
    for (const { ledger, told } of killed) {
      const kept = ledger.db.prepare('SELECT DISTINCT description FROM transactions').pluck().all()
      expect(told.filter((n) => !kept.includes(`batch ${n}`))).toEqual([])
    }
  })

  it('every transaction sums to zero in each currency', () => {
    for (const { ledger } of killed) {
      const unbalanced = ledger.db
        .prepare(
          'SELECT transactionId FROM postings GROUP BY transactionId, currency HAVING sum(amountCents) <> 0',
        )
        .pluck()
        .all()
      expect(unbalanced).toEqual([])
    }
  })

  it('every spend has its two postings', () => {
    for (const { ledger } of killed) {
      const short = ledger.db
        .prepare(
          'SELECT count(*) FROM transactions t WHERE (SELECT count(*) FROM postings p WHERE p.transactionId = t.id) <> 2',
        )
        .pluck()
        .get()
      expect(short).toBe(0)
    }
  })

  it('the outbox holds one row for each document, and none for another', () => {
    for (const { ledger } of killed) {
      const documents = ledger.db
        .prepare(
          "SELECT 'account:' || id FROM accounts UNION ALL SELECT 'transaction:' || id FROM transactions ORDER BY 1",
        )
        .pluck()
        .all()
      const queued = ledger.db
        .prepare("SELECT docType || ':' || docId FROM outbox ORDER BY 1")
        .pluck()
        .all()
      expect(documents).not.toEqual([])
      expect(queued).toEqual(documents)
    }
  })
})
