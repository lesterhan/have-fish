// The one way a document reaches the ledger file: check it, decide which version wins, store it,
// and move the clock, with the whole batch in one SQLite transaction.

import { type Clock, MAX_DRIFT_MS, tick } from '@have-fish/core/clock'
import { decide } from '@have-fish/core/decide'
import { type LedgerDocument, readDocument, type TransactionDoc } from '@have-fish/core/documents'
import type { FailureCode, FailureDetails, Outcome } from '@have-fish/core/outcome'
import { formatVersion, type Version } from '@have-fish/core/version'
import type Database from 'better-sqlite3'
import { loadClock, saveClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
import { countTransactionsUsing, getDocument, putDocument } from './store'

export type Written = { type: LedgerDocument['type']; id: string; version: Version }

/** An item a batch refused: where it was in the batch as passed, and why. */
export type Refusal = { at: number; code: FailureCode; details: FailureDetails[FailureCode] }

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

type Failure = Extract<Outcome<never>, { ok: false }>['failure']
const refusal = (at: number, failure: Failure): Refusal => ({ at, ...failure })

/** A checked document, and where it was in the batch as passed. */
type Item = { at: number; doc: LedgerDocument }

/** Accounts before transactions, so one batch can make an account and post to it. Stable. */
const accountsFirst = (items: Item[]) =>
  items.toSorted((a, b) => Number(a.doc.type !== 'account') - Number(b.doc.type !== 'account'))

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
    const items = accountsFirst(read)
    return { ok: true, value: ledger.db.transaction(() => writeLocal(ledger, items, now))() }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, failure: e.refusal }
    throw e
  }
}

function writeLocal(ledger: Ledger, items: Item[], now: number): Applied {
  const { db } = ledger
  let clock = loadClock(db)
  const written: Written[] = []

  for (const { at, doc } of items) {
    const ticked = tick(clock, now, ledger.meta.deviceId)
    if (!ticked.ok) throw new Refused(refusal(at, ticked.failure))
    clock = ticked.value.clock
    const { version } = ticked.value

    if (doc.type === 'transaction') checkPostedAccounts(db, at, doc)
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

  // After the whole batch, so deleting an account with the transactions that used it succeeds.
  for (const { at, doc } of items) {
    if (doc.type === 'account' && doc.deletedAt !== null) checkUnused(db, at, doc.id)
  }

  saveClock(db, clock)
  return { written, same: 0, stale: 0, refused: [], clockAhead: isAhead(clock, now) }
}

/** A clock stuck in the future (a device that once read 2030) is reported, not refused. */
const isAhead = (clock: Clock, now: number) => clock.wallMs > now + MAX_DRIFT_MS

/** A local posting points at an account this file holds, and that is live. */
function checkPostedAccounts(db: Database.Database, at: number, doc: TransactionDoc): void {
  for (const accountId of new Set(doc.postings.map((p) => p.accountId))) {
    const account = getDocument(db, 'account', accountId)
    if (account === null)
      throw new Refused({ at, code: 'ACCOUNT_NOT_FOUND', details: { accountId } })
    if (account.doc.deletedAt !== null) {
      throw new Refused({ at, code: 'ACCOUNT_DELETED', details: { accountId } })
    }
  }
}

/** A locally deleted account has no live transactions posting to it. */
function checkUnused(db: Database.Database, at: number, accountId: string): void {
  const transactions = countTransactionsUsing(db, accountId)
  if (transactions > 0) {
    throw new Refused({ at, code: 'ACCOUNT_IN_USE', details: { accountId, transactions } })
  }
}
