// Opens the ledger file the same way every time: a private directory, crash-safe settings,
// migrations, and the meta row. Built up a step at a time.

import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Outcome } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'

export type Ledger = { db: Database.Database; close(): void }

export type OpenOptions = {
  /** The ledger directory; made private (0700) if it isn't. */
  dir: string
}

const LEDGER_FILE = 'ledger.sqlite'

export function openLedger(options: OpenOptions): Outcome<Ledger> {
  mkdirSync(options.dir, { recursive: true, mode: 0o700 })
  chmodSync(options.dir, 0o700)
  const db = new Database(join(options.dir, LEDGER_FILE))
  return { ok: true, value: { db, close: () => db.close() } }
}
