// The one way a document reaches the ledger file: check it, decide which version wins, store it,
// and move the clock, with the whole batch in one SQLite transaction.

import { isDeepStrictEqual } from 'node:util'
import { type Clock, MAX_DRIFT_MS, receive, tick } from '@have-fish/core/clock'
import { decide } from '@have-fish/core/decide'
import {
  DOCUMENT_TYPES,
  type DocumentOf,
  type DocumentTypeName,
  type LedgerDocument,
  readDocument,
} from '@have-fish/core/documents'
import type { Failure } from '@have-fish/core/outcome'
import { formatVersion, type Version } from '@have-fish/core/version'
import { readVersioned } from '@have-fish/core/versioned'
import type Database from 'better-sqlite3'
import { loadClock, saveClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
import { STORED_TYPES, type WrittenItem } from './document-types'
import { enqueue, supersede } from './outbox'
import { getDocument, putDocument } from './store'

export type Written = { type: LedgerDocument['type']; id: string; version: Version }

/** An item a batch refused: where it was in the batch as passed, and why. */
export type Refusal = Failure & { at: number }

export type Applied = {
  written: Written[]
  same: number
  stale: number
  /** Always empty for a local batch: one refusal refuses all of it. */
  refused: Refusal[]
  /** The saved clock is more than `MAX_DRIFT_MS` ahead of `now`. Writing goes on regardless. */
  clockAhead: boolean
}

/** An `Outcome` whose failure also says which item failed. */
export type BatchOutcome = { ok: true; value: Applied } | { ok: false; failure: Refusal }

const refusal = (at: number, failure: Failure): Refusal => ({ at, ...failure })

/** A checked document, and where it was in the batch as passed. */
type Item = { at: number; doc: LedgerDocument }

/** Lowest rank first, so one batch can make an account and post to it. Stable. */
export const byRank = <T extends { doc: LedgerDocument }>(items: T[]) =>
  items.toSorted((a, b) => DOCUMENT_TYPES[a.doc.type].rank - DOCUMENT_TYPES[b.doc.type].rank)

// Thrown inside the transaction to roll it back, and caught outside it.
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.code)
  }
}

/**
 * Documents made on this device. Each gets a version from the clock. All or nothing: if one is
 * refused, nothing is written and the clock doesn't move.
 */
export function applyLocal(ledger: Ledger, docs: unknown[], now: number): BatchOutcome {
  const read: Item[] = []
  for (const [at, input] of docs.entries()) {
    const doc = readDocument(input)
    if (!doc.ok) return { ok: false, failure: refusal(at, doc.failure) }
    read.push({ at, doc: doc.value })
  }

  try {
    const items = byRank(read)
    return { ok: true, value: ledger.db.transaction(() => writeLocal(ledger, items, now))() }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, failure: e.refusal }
    throw e
  }
}

/**
 * `{ doc, version }` envelopes from another device. Each moves the clock past its version. What
 * can be applied is, in one transaction; each item refused is left out and reported.
 */
export function applyReceived(ledger: Ledger, items: unknown[], now: number): Applied {
  const read: (Item & { version: Version })[] = []
  const refused: Refusal[] = []
  for (const [at, input] of items.entries()) {
    const envelope = readVersioned(input)
    if (envelope.ok) read.push({ at, ...envelope.value })
    else refused.push(refusal(at, envelope.failure))
  }

  return ledger.db.transaction(() => {
    const { db } = ledger
    let clock = loadClock(db)
    const applied: Applied = { written: [], same: 0, stale: 0, refused, clockAhead: false }

    for (const { at, doc, version } of byRank(read)) {
      const received = receive(clock, version, now)
      if (!received.ok) {
        refused.push(refusal(at, received.failure))
        continue
      }
      clock = received.value

      const { decision } = store(db, doc, version)
      if (decision === 'write') {
        applied.written.push({ type: doc.type, id: doc.id, version })
        supersede(db, doc.type, doc.id)
      } else applied[decision] += 1
    }

    saveClock(db, clock)
    refused.sort((a, b) => a.at - b.at)
    applied.clockAhead = isAhead(clock, now)
    return applied
  })()
}

function writeLocal(ledger: Ledger, items: Item[], now: number): Applied {
  const { db } = ledger
  let clock = loadClock(db)
  const written: Written[] = []
  const batch: WrittenItem<LedgerDocument>[] = []

  for (const { at, doc } of items) {
    const ticked = tick(clock, now, ledger.meta.deviceId)
    clock = ticked.clock
    const { version } = ticked

    const failure = checkEach(doc.type, db, at, doc)
    if (failure !== null) throw new Refused(refusal(at, failure))
    const { decision, stored, previous } = store(db, doc, version, { at })
    // The clock has seen every version in this file, so a tick beats them all. If it doesn't,
    // the file holds a version the clock never saw: a bug, not an edit to drop quietly.
    if (decision !== 'write') {
      throw new Error(
        `A local version lost: ${doc.id} holds ${formatVersion(stored ?? version)}, ` +
          `the clock gave ${formatVersion(version)}`,
      )
    }
    written.push({ type: doc.type, id: doc.id, version })
    enqueue(db, { doc, version })
    batch.push({ at, doc, previous })
  }

  for (const type of Object.keys(STORED_TYPES) as DocumentTypeName[]) {
    const refused = checkBatch(type, db, batch)
    if (refused !== null) throw new Refused(refused)
  }

  saveClock(db, clock)
  return { written, same: 0, stale: 0, refused: [], clockAhead: isAhead(clock, now) }
}

const checkEach = <T extends DocumentTypeName>(
  type: T,
  db: Database.Database,
  at: number,
  doc: DocumentOf<T>,
) => STORED_TYPES[type].checkEach(db, at, doc)

/** A type's check over the items of that type in a local batch. */
function checkBatch<T extends DocumentTypeName>(
  type: T,
  db: Database.Database,
  batch: WrittenItem<LedgerDocument>[],
): Refusal | null {
  const ofType = batch.filter((item): item is WrittenItem<DocumentOf<T>> => item.doc.type === type)
  return STORED_TYPES[type].checkBatch(db, ofType)
}

/**
 * The step both ways in share: read the stored version, decide, and put if the incoming wins.
 * `local` is a local write's place in its batch: one may not change a stored origin.
 */
function store(
  db: Database.Database,
  doc: LedgerDocument,
  version: Version,
  local?: { at: number },
) {
  const current = getDocument(db, doc.type, doc.id)
  if (local && current && !isDeepStrictEqual(current.doc.origin, doc.origin)) {
    throw new Refused({ at: local.at, code: 'ORIGIN_CHANGED', details: { id: doc.id } })
  }
  const stored = current?.version ?? null
  const decision = decide(stored, version)
  if (decision === 'write') putDocument(db, { doc, version })
  return { decision, stored, previous: current?.doc ?? null }
}

/** A clock stuck in the future (a device that once read 2030) is reported, not refused. */
const isAhead = (clock: Clock, now: number) => clock.wallMs > now + MAX_DRIFT_MS
