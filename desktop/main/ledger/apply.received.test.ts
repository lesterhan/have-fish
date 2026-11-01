import { MAX_DRIFT_MS } from '@have-fish/core/clock'
import type { Version } from '@have-fish/core/version'
import { describe, expect, test } from 'vitest'
import { loadClock } from '../db/clock'
import { applyLocal, applyReceived } from './apply'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from './fixtures'
import { countTransactionsUsing, getDocument, pendingReferences } from './store'

/** Another device's id. */
const THERE = 'f0e1d2c3b4a59687'
const at = (wallMs: number, counter = 0): Version => ({ wallMs, counter, deviceId: THERE })

const CASH = anAccount()
const FOOD = anAccount({ path: 'expenses:food', kind: 'category' })
const ACCOUNTS = [
  { doc: CASH, version: at(NOW - 2000) },
  { doc: FOOD, version: at(NOW - 2000) },
]

describe('applyReceived', () => {
  test('a newer version is written, with the version it came with', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    applyReceived(ledger, [...ACCOUNTS, { doc: spend, version: at(NOW - 1000) }], NOW)
    const edit = { doc: { ...spend, description: 'Edited' }, version: at(NOW) }

    const applied = applyReceived(ledger, [edit], NOW)

    expect(applied).toEqual({
      written: [{ type: 'transaction', id: spend.id, version: at(NOW) }],
      same: 0,
      stale: 0,
      refused: [],
      clockAhead: false,
    })
    expect(getDocument(ledger.db, 'transaction', spend.id)).toEqual(edit)
  })

  test('the same version again is counted same, and an older one stale', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    const current = { doc: spend, version: at(NOW) }
    applyReceived(ledger, [...ACCOUNTS, current], NOW)
    const older = { doc: { ...spend, description: 'Older' }, version: at(NOW - 1) }

    const applied = applyReceived(ledger, [current, older], NOW)

    expect(applied).toMatchObject({ written: [], same: 1, stale: 1, refused: [] })
    expect(getDocument(ledger.db, 'transaction', spend.id)).toEqual(current)
  })

  test('a newer version with another origin is stored as it came: the check is local only', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    applyReceived(ledger, [...ACCOUNTS, { doc: spend, version: at(NOW - 1000) }], NOW)
    const origin = { source: 'system', createdAt: NOW, deviceId: THERE } as const
    const edit = { doc: { ...spend, origin }, version: at(NOW) }

    expect(applyReceived(ledger, [edit], NOW).refused).toEqual([])
    expect(getDocument(ledger.db, 'transaction', spend.id)).toEqual(edit)
  })

  test('a tombstone for an unknown id is stored, so an older live version is stale', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    const tombstone = { doc: tombstoneOf(spend), version: at(NOW) }

    expect(applyReceived(ledger, [tombstone], NOW).written).toHaveLength(1)
    expect(applyReceived(ledger, [{ doc: spend, version: at(NOW - 1) }], NOW).stale).toBe(1)
    expect(getDocument(ledger.db, 'transaction', spend.id)).toEqual(tombstone)
  })

  test('a malformed item is refused with its place, and the rest of the batch is written', () => {
    const ledger = tempLedger()
    const applied = applyReceived(ledger, [ACCOUNTS[0], { doc: CASH }, ACCOUNTS[1]], NOW)
    expect(applied.written.map((w) => w.id)).toEqual([CASH.id, FOOD.id])
    expect(applied.refused).toEqual([
      { at: 1, code: 'VERSION_MALFORMED', details: { path: 'version', issue: 'invalid_type' } },
    ])
  })

  test('an item more than the drift ahead is refused as CLOCK_DRIFT, and the rest is written', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    const tooFar = { doc: spend, version: at(NOW + MAX_DRIFT_MS + 1) }

    const applied = applyReceived(ledger, [...ACCOUNTS, tooFar], NOW)

    expect(applied.written).toHaveLength(2)
    expect(applied.refused).toEqual([
      {
        at: 2,
        code: 'CLOCK_DRIFT',
        details: { remoteWallMs: NOW + MAX_DRIFT_MS + 1, now: NOW },
      },
    ])
    expect(getDocument(ledger.db, 'transaction', spend.id)).toBeNull()
    expect(loadClock(ledger.db).wallMs).toBe(NOW)
  })

  test('after a version from the future within the drift, a local edit is still newer', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    const ahead = at(NOW + MAX_DRIFT_MS - 1)
    const received = applyReceived(ledger, [...ACCOUNTS, { doc: spend, version: ahead }], NOW)
    expect(received.clockAhead).toBe(false)

    const local = ok(applyLocal(ledger, [{ ...spend, description: 'Mine' }], NOW))

    expect(local.written[0]?.version).toEqual({
      wallMs: ahead.wallMs,
      counter: 2,
      deviceId: ledger.meta.deviceId,
    })
    expect(local.clockAhead).toBe(false)
    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc.description).toBe('Mine')
  })
})

describe("applyReceived, a posting's account", () => {
  test('a transaction whose account has not arrived is stored, and pending until it does', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    applyReceived(ledger, [ACCOUNTS[0], { doc: spend, version: at(NOW) }], NOW)

    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc).toEqual(spend)
    expect(pendingReferences(ledger.db)).toEqual([{ transactionId: spend.id, accountId: FOOD.id }])

    applyReceived(ledger, [ACCOUNTS[1]], NOW)
    expect(pendingReferences(ledger.db)).toEqual([])
  })

  test('a posting to a deleted account is stored as it is', () => {
    const ledger = tempLedger()
    const spend = aSpend(CASH.id, FOOD.id)
    const deletedFood = { doc: { ...FOOD, deletedAt: NOW }, version: at(NOW - 1000) }

    const applied = applyReceived(
      ledger,
      [ACCOUNTS[0], deletedFood, { doc: spend, version: at(NOW) }],
      NOW,
    )

    expect(applied.refused).toEqual([])
    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc).toEqual(spend)
  })

  test('deleting an account live transactions use is stored as it is', () => {
    const ledger = tempLedger()
    applyReceived(ledger, [...ACCOUNTS, { doc: aSpend(CASH.id, FOOD.id), version: at(NOW) }], NOW)

    applyReceived(ledger, [{ doc: { ...FOOD, deletedAt: NOW }, version: at(NOW + 1) }], NOW)

    expect(getDocument(ledger.db, 'account', FOOD.id)?.doc.deletedAt).toBe(NOW)
    expect(countTransactionsUsing(ledger.db, FOOD.id)).toBe(1)
  })
})
