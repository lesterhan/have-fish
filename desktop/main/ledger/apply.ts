// The one way a document reaches the ledger file: check it, decide which version wins, store it,
// and move the clock, with the whole batch in one SQLite transaction.

import { tick } from '@have-fish/core/clock'
import { decide } from '@have-fish/core/decide'
import { type LedgerDocument, readDocument } from '@have-fish/core/documents'
import type { FailureCode, FailureDetails, Outcome } from '@have-fish/core/outcome'
import { formatVersion, type Version } from '@have-fish/core/version'
import { loadClock, saveClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
import { getDocument, putDocument } from './store'

export type Written = { type: LedgerDocument['type']; id: string; version: Version }

/** An item a batch refused: where it was in the batch as passed, and why. */
export type Refusal = { at: number; code: FailureCode; details: FailureDetails[FailureCode] }

export type Applied = {
  written: Written[]
  same: number
  stale: number
  /** Always empty for a local batch: one refusal refuses all of it. */
  refused: Refusal[]
}

/** An `Outcome` whose failure also says which item failed. */
export type BatchOutcome = { ok: true; value: Applied } | { ok: false; failure: Refusal }

type Failure = Extract<Outcome<never>, { ok: false }>['failure']
const refusal = (at: number, failure: Failure): Refusal => ({ at, ...failure })

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
  const read: LedgerDocument[] = []
  for (const [at, input] of docs.entries()) {
    const doc = readDocument(input)
    if (!doc.ok) return { ok: false, failure: refusal(at, doc.failure) }
    read.push(doc.value)
  }

  try {
    return { ok: true, value: ledger.db.transaction(() => writeLocal(ledger, read, now))() }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, failure: e.refusal }
    throw e
  }
}

function writeLocal(ledger: Ledger, docs: LedgerDocument[], now: number): Applied {
  const { db } = ledger
  let clock = loadClock(db)
  const written: Written[] = []

  for (const [at, doc] of docs.entries()) {
    const ticked = tick(clock, now, ledger.meta.deviceId)
    if (!ticked.ok) throw new Refused(refusal(at, ticked.failure))
    clock = ticked.value.clock
    const { version } = ticked.value

    const stored = getDocument(db, doc.type, doc.id)
    // The clock has seen every version in this file, so a tick beats them all. If it doesn't,
    // the file holds a version the clock never saw: a bug, not an edit to drop quietly.
    if (decide(stored?.version ?? null, version) !== 'write') {
      throw new Error(
        `A local version lost: ${doc.id} holds ${formatVersion(stored?.version ?? version)}, ` +
          `the clock gave ${formatVersion(version)}`,
      )
    }
    putDocument(db, { doc, version })
    written.push({ type: doc.type, id: doc.id, version })
  }

  saveClock(db, clock)
  return { written, same: 0, stale: 0, refused: [] }
}
