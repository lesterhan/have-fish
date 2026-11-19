import { formatVersion } from '@have-fish/core/version'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, onTestFinished, test } from 'vitest'
import type { Ledger } from '../db/ledger'
import { applyLocal, applyReceived } from './apply'
import { checkLedger } from './check'
import {
  aLedgerOf,
  anAccount,
  aSpend,
  MAKER,
  NOW,
  ok,
  openTempLedger,
  tempLedger,
  tombstoneOf,
} from './fixtures'
import { queued } from './outbox'

/** A ledger with cash, food and a spend of 42.10 between them, and its newest version's text. */
function withSpend() {
  const ledger = tempLedger()
  const cash = anAccount()
  const food = anAccount({ path: 'expenses:food', kind: 'category' })
  const spend = aSpend(cash.id, food.id, '42.10')
  const newest = ok(applyLocal(ledger, [cash, food, spend], NOW)).written.at(-1)
  if (newest === undefined) throw new Error('applyLocal wrote nothing')
  return { ledger, cash, food, spend, newest: formatVersion(newest.version) }
}

/** Changes the file by hand, around the ledger's own code. */
function damage(ledger: Ledger, sql: string, ...args: unknown[]) {
  ledger.db.prepare(sql).run(...args)
}

/** The same, past the tables' CHECK constraints, which are back on before the check runs. */
function damageUnchecked(ledger: Ledger, sql: string, ...args: unknown[]) {
  ledger.db.pragma('ignore_check_constraints = ON')
  damage(ledger, sql, ...args)
  ledger.db.pragma('ignore_check_constraints = OFF')
}

/** The outbox row queued for a document. */
function rowOf(ledger: Ledger, id: string): string {
  const rowId = queued(ledger.db, 10).find((r) => r.docId === id)?.rowId
  if (rowId === undefined) throw new Error(`nothing queued for ${id}`)
  return rowId
}

/** Older than anything `withSpend` wrote. */
const EARLIER = formatVersion({ wallMs: NOW - 1000, counter: 0, deviceId: MAKER })

describe('checkLedger', () => {
  test('finds nothing in a sound ledger, whose clock is at its newest version and outbox at its documents', () => {
    const { ledger } = withSpend()
    expect(checkLedger(ledger.db)).toEqual({ faults: [], pending: 0 })
  })

  test('finds each line integrity_check says, in its order', () => {
    const { ledger, spend } = withSpend()
    damageUnchecked(ledger, "UPDATE meta SET deviceId = 'not-hex'")
    damageUnchecked(
      ledger,
      "UPDATE postings SET amountCents = '12.50' WHERE transactionId = ? AND position = 0",
      spend.id,
    )
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'FILE_DAMAGED', message: 'CHECK constraint failed in meta' },
      { code: 'FILE_DAMAGED', message: 'CHECK constraint failed in postings' },
    ])
  })

  test('stops at a file integrity_check finds damaged, reading nothing it says is broken', () => {
    const { ledger, spend } = withSpend()
    damageUnchecked(
      ledger,
      "UPDATE postings SET amountCents = '12.50' WHERE transactionId = ? AND position = 0",
      spend.id,
    )
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'FILE_DAMAGED', message: 'CHECK constraint failed in postings' },
    ])
  })

  test('finds a transaction off in a currency, and by how many cents', () => {
    const { ledger, spend } = withSpend()
    damage(
      ledger,
      'UPDATE postings SET amountCents = -4110 WHERE transactionId = ? AND position = 0',
      spend.id,
    )
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'POSTINGS_DO_NOT_BALANCE', transactionId: spend.id, currency: 'CAD', cents: 100 },
    ])
  })

  test('finds a transaction off in each currency though it sums to zero across them', () => {
    const { ledger, spend } = withSpend()
    damage(
      ledger,
      "UPDATE postings SET currency = 'EUR' WHERE transactionId = ? AND position = 1",
      spend.id,
    )
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'POSTINGS_DO_NOT_BALANCE', transactionId: spend.id, currency: 'CAD', cents: -4210 },
      { code: 'POSTINGS_DO_NOT_BALANCE', transactionId: spend.id, currency: 'EUR', cents: 4210 },
    ])
  })

  test('names an account whose version does not read', () => {
    const { ledger, cash } = withSpend()
    damage(ledger, "UPDATE accounts SET version = 'not a version' WHERE id = ?", cash.id)
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'VERSION_MALFORMED', table: 'accounts', id: cash.id },
    ])
  })

  test('names a transaction whose version does not read', () => {
    const { ledger, spend } = withSpend()
    damage(ledger, "UPDATE transactions SET version = 'not a version' WHERE id = ?", spend.id)
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'VERSION_MALFORMED', table: 'transactions', id: spend.id },
    ])
  })

  test('says a row is ahead only when both versions read, whichever way the text sorts', () => {
    const low = withSpend()
    damage(low.ledger, "UPDATE transactions SET version = '1999' WHERE id = ?", low.spend.id)
    const high = withSpend()
    const rowId = rowOf(high.ledger, high.spend.id)
    damage(high.ledger, "UPDATE outbox SET version = 'zzz' WHERE rowId = ?", rowId)
    expect([checkLedger(low.ledger.db).faults, checkLedger(high.ledger.db).faults]).toEqual([
      [{ code: 'VERSION_MALFORMED', table: 'transactions', id: low.spend.id }],
      [{ code: 'VERSION_MALFORMED', table: 'outbox', id: rowId }],
    ])
  })

  test('names an outbox row whose version has the right form and a day that is not', () => {
    const { ledger, spend } = withSpend()
    const rowId = rowOf(ledger, spend.id)
    damage(
      ledger,
      "UPDATE outbox SET version = '2026-02-30T12:00:00.000Z-0000-feedfacecafebeef' WHERE rowId = ?",
      rowId,
    )
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'VERSION_MALFORMED', table: 'outbox', id: rowId },
    ])
  })

  test('finds the clock a count behind the newest version at the same time', () => {
    const { ledger, newest } = withSpend()
    damage(ledger, 'UPDATE meta SET clockCounter = clockCounter - 1')
    expect(checkLedger(ledger.db).faults).toEqual([{ code: 'CLOCK_BEHIND', newest }])
  })

  test('finds the clock at an earlier time behind the newest version, whatever its count', () => {
    const { ledger, newest } = withSpend()
    damage(ledger, 'UPDATE meta SET clockWallMs = ?, clockCounter = 99', NOW - 1)
    expect(checkLedger(ledger.db).faults).toEqual([{ code: 'CLOCK_BEHIND', newest }])
  })

  test('finds a deleted transaction that holds a posting', () => {
    const { ledger, cash, spend } = withSpend()
    ok(applyLocal(ledger, [tombstoneOf(spend)], NOW))
    damage(
      ledger,
      "INSERT INTO postings (transactionId, position, accountId, amountCents, currency) VALUES (?, 0, ?, 0, 'CAD')",
      spend.id,
      cash.id,
    )
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'TOMBSTONE_HAS_POSTINGS', transactionId: spend.id },
    ])
  })

  test('finds a live transaction with one posting, though it balances', () => {
    const { ledger, spend } = withSpend()
    damage(ledger, 'DELETE FROM postings WHERE transactionId = ? AND position = 1', spend.id)
    damage(ledger, 'UPDATE postings SET amountCents = 0 WHERE transactionId = ?', spend.id)
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'TOO_FEW_POSTINGS', transactionId: spend.id },
    ])
  })

  test('finds a live transaction with no postings', () => {
    const { ledger, spend } = withSpend()
    damage(ledger, 'DELETE FROM postings WHERE transactionId = ?', spend.id)
    expect(checkLedger(ledger.db).faults).toEqual([
      { code: 'TOO_FEW_POSTINGS', transactionId: spend.id },
    ])
  })

  test('finds an outbox row for a document the tables do not hold', () => {
    const { ledger, spend } = withSpend()
    const rowId = rowOf(ledger, spend.id)
    damage(ledger, 'DELETE FROM transactions WHERE id = ?', spend.id)
    expect(checkLedger(ledger.db).faults).toEqual([{ code: 'OUTBOX_NAMES_NOTHING', rowId }])
  })

  test('finds an outbox row of a type the ledger does not store', () => {
    const { ledger, spend } = withSpend()
    const rowId = rowOf(ledger, spend.id)
    damage(ledger, "UPDATE outbox SET docType = 'budget' WHERE rowId = ?", rowId)
    expect(checkLedger(ledger.db).faults).toEqual([{ code: 'OUTBOX_NAMES_NOTHING', rowId }])
  })

  test('finds an outbox row ahead of its document', () => {
    const { ledger, spend } = withSpend()
    const rowId = rowOf(ledger, spend.id)
    damage(ledger, 'UPDATE transactions SET version = ? WHERE id = ?', EARLIER, spend.id)
    expect(checkLedger(ledger.db).faults).toEqual([{ code: 'OUTBOX_AHEAD', rowId }])
  })

  test('finds nothing in an outbox row older than its document', () => {
    const { ledger, spend } = withSpend()
    damage(
      ledger,
      'UPDATE outbox SET version = ? WHERE rowId = ?',
      EARLIER,
      rowOf(ledger, spend.id),
    )
    expect(checkLedger(ledger.db).faults).toEqual([])
  })

  test('finds each imported transaction missing its file, its line or its text', () => {
    const { ledger, cash, food } = withSpend()
    const imported = [2, 3, 4].map((line) =>
      aSpend(cash.id, food.id, '1.00', {
        origin: {
          source: 'import',
          createdAt: NOW,
          deviceId: MAKER,
          file: 'bank.csv',
          line,
          text: 'GROCER',
        },
      }),
    )
    ok(applyLocal(ledger, imported, NOW))
    const ids = imported.map((t) => t.id)
    const [first, second, third] = ids
    damage(ledger, 'UPDATE transactions SET originFile = NULL WHERE id = ?', first)
    damage(ledger, 'UPDATE transactions SET originLine = NULL WHERE id = ?', second)
    damage(ledger, 'UPDATE transactions SET originText = NULL WHERE id = ?', third)
    expect(checkLedger(ledger.db).faults).toEqual(
      ids.toSorted().map((transactionId) => ({ code: 'IMPORT_ORIGIN_MISSING', transactionId })),
    )
  })

  test('counts a posting to an account the file does not hold, and finds nothing', () => {
    const { ledger, food } = withSpend()
    const ghost = anAccount({ path: 'assets:ghost', kind: 'bank' })
    const doc = aSpend(ghost.id, food.id)
    const received = applyReceived(
      ledger,
      [{ doc, version: { wallMs: NOW + 1000, counter: 0, deviceId: MAKER } }],
      NOW + 2000,
    )
    expect(received.written).toHaveLength(1)
    expect(checkLedger(ledger.db)).toEqual({ faults: [], pending: 1 })
  })

  test('finds the same on a read-only connection, so it never writes', () => {
    const { ledger, spend } = withSpend()
    damage(
      ledger,
      'UPDATE postings SET amountCents = -4110 WHERE transactionId = ? AND position = 0',
      spend.id,
    )
    const reader = new Database(ledger.db.name, { readonly: true })
    onTestFinished(() => {
      reader.close()
    })
    expect(checkLedger(reader).faults.map((f) => f.code)).toEqual(['POSTINGS_DO_NOT_BALANCE'])
  })
})

describe('checkLedger at ten years', { timeout: 120_000 }, () => {
  const temp = openTempLedger()
  afterAll(temp.dispose)
  const ledger = aLedgerOf(50_000, temp.ledger)

  test('finds nothing', () => {
    expect(checkLedger(ledger.db)).toEqual({ faults: [], pending: 0 })
  })

  test('takes under 5,000 ms', () => {
    const started = performance.now()
    checkLedger(ledger.db)
    // Measured at about 1.1 s. Loose for a slow runner.
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})
