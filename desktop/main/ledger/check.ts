// The ledger check: what is wrong in a ledger file, as a list. It reads one snapshot and never
// writes. SQLite's integrity_check looks at the file's structure; the rest at what it holds.

import { compareVersions, parseVersion, type Version } from '@have-fish/core/version'
import type Database from 'better-sqlite3'
import { loadClock } from '../db/clock'
import { STORED_TYPES } from './document-types'
import { pendingReferences } from './store'

/** What the check found. A code the ledger also refuses with means the same rule here. */
export type Fault =
  | { code: 'FILE_DAMAGED'; message: string }
  | { code: 'POSTINGS_DO_NOT_BALANCE'; transactionId: string; currency: string; cents: number }
  | { code: 'VERSION_MALFORMED'; table: string; id: string }
  | { code: 'CLOCK_BEHIND'; newest: string }
  | { code: 'TOMBSTONE_HAS_POSTINGS'; transactionId: string }
  | { code: 'TOO_FEW_POSTINGS'; transactionId: string }
  | { code: 'OUTBOX_NAMES_NOTHING'; rowId: string }
  | { code: 'OUTBOX_AHEAD'; rowId: string }
  | { code: 'IMPORT_ORIGIN_MISSING'; transactionId: string }

/** `pending`: postings whose account the file doesn't hold yet, by transaction and account. */
export type LedgerCheck = { faults: Fault[]; pending: number }

type VersionRow = { id: string; version: string }

export function checkLedger(db: Database.Database): LedgerCheck {
  return db.transaction((): LedgerCheck => {
    const integrity = db.prepare<[], string>('PRAGMA integrity_check').pluck().all()
    // A damaged file stops here: the queries below would read what it says is broken.
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      return {
        faults: integrity.map((message) => ({ code: 'FILE_DAMAGED', message })),
        pending: 0,
      }
    }
    const faults: Fault[] = []

    const unbalanced = db
      .prepare<[], { transactionId: string; currency: string; cents: number }>(
        `SELECT transactionId, currency, sum(amountCents) AS cents FROM postings
         GROUP BY transactionId, currency HAVING cents <> 0 ORDER BY transactionId, currency`,
      )
      .all()
    for (const sum of unbalanced) faults.push({ code: 'POSTINGS_DO_NOT_BALANCE', ...sum })

    const versioned = [
      ...Object.values(STORED_TYPES).map(({ table }) => ({
        table,
        rows: () => db.prepare<[], VersionRow>(`SELECT id, version FROM ${table}`).iterate(),
      })),
      {
        table: 'outbox',
        rows: () => db.prepare<[], VersionRow>('SELECT rowId AS id, version FROM outbox').iterate(),
      },
    ]
    let newest: { version: Version; text: string } | null = null
    const unreadable = new Set<string>()
    for (const { table, rows } of versioned) {
      for (const row of rows()) {
        const read = parseVersion(row.version)
        if (!read.ok) {
          faults.push({ code: 'VERSION_MALFORMED', table, id: row.id })
          unreadable.add(`${table} ${row.id}`)
        } else if (newest === null || compareVersions(read.value, newest.version) > 0) {
          newest = { version: read.value, text: row.version }
        }
      }
    }
    const clock = loadClock(db)
    if (
      newest !== null &&
      (clock.wallMs < newest.version.wallMs ||
        (clock.wallMs === newest.version.wallMs && clock.counter < newest.version.counter))
    ) {
      faults.push({ code: 'CLOCK_BEHIND', newest: newest.text })
    }

    const tombstones = db
      .prepare<[], string>(
        `SELECT id FROM transactions t WHERE deletedAt IS NOT NULL
         AND EXISTS (SELECT 1 FROM postings p WHERE p.transactionId = t.id) ORDER BY id`,
      )
      .pluck()
      .all()
    for (const transactionId of tombstones) {
      faults.push({ code: 'TOMBSTONE_HAS_POSTINGS', transactionId })
    }
    const thin = db
      .prepare<[], string>(
        `SELECT id FROM transactions t WHERE deletedAt IS NULL
         AND (SELECT count(*) FROM postings p WHERE p.transactionId = t.id) < 2 ORDER BY id`,
      )
      .pluck()
      .all()
    for (const transactionId of thin) faults.push({ code: 'TOO_FEW_POSTINGS', transactionId })

    for (const [type, { table }] of Object.entries(STORED_TYPES)) {
      const rows = db
        .prepare<[string], { rowId: string; docId: string; missing: number }>(
          `SELECT o.rowId, o.docId, d.id IS NULL AS missing FROM outbox o
           LEFT JOIN ${table} d ON d.id = o.docId
           WHERE o.docType = ? AND (d.id IS NULL OR o.version > d.version) ORDER BY o.rowId`,
        )
        .all(type)
      for (const { rowId, docId, missing } of rows) {
        if (missing) faults.push({ code: 'OUTBOX_NAMES_NOTHING', rowId })
        // Version text sorts in version order only when it reads, so ahead is said of those alone.
        else if (!unreadable.has(`outbox ${rowId}`) && !unreadable.has(`${table} ${docId}`)) {
          faults.push({ code: 'OUTBOX_AHEAD', rowId })
        }
      }
    }
    const types = Object.keys(STORED_TYPES)
    const untyped = db
      .prepare<string[], string>(
        `SELECT rowId FROM outbox WHERE docType NOT IN (${types.map(() => '?').join(', ')})
         ORDER BY rowId`,
      )
      .pluck()
      .all(...types)
    for (const rowId of untyped) faults.push({ code: 'OUTBOX_NAMES_NOTHING', rowId })

    const unsourced = db
      .prepare<[], string>(
        `SELECT id FROM transactions WHERE originSource = 'import'
         AND (originFile IS NULL OR originLine IS NULL OR originText IS NULL) ORDER BY id`,
      )
      .pluck()
      .all()
    for (const transactionId of unsourced) {
      faults.push({ code: 'IMPORT_ORIGIN_MISSING', transactionId })
    }

    // Sync can bring a spend before its account, so that is counted, not a fault.
    return { faults, pending: pendingReferences(db).length }
  })()
}
