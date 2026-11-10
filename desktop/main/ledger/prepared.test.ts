// Once each query has run, the ledger's work prepares no more SQL: every statement is built once
// per open file and reused.

import { describe, expect, test, vi } from 'vitest'
import { contextFor } from '../context'
import { loadClock, saveClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
import { editSpend, writeSpend } from '../services/spends'
import { listTransactions } from '../services/transactions'
import { applyLocal, applyReceived } from './apply'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from './fixtures'
import { acknowledge, enqueue, queued, supersede } from './outbox'
import {
  countTransactionsUsing,
  currenciesPostedTo,
  getDocument,
  liveAccountAt,
  pendingReferences,
  putDocument,
} from './store'

/** How many statements `work` prepares, the second time it runs. */
function preparedOnSecondRun(ledger: Ledger, work: () => void): number {
  work()
  const prepare = vi.spyOn(ledger.db, 'prepare')
  try {
    work()
    return prepare.mock.calls.length
  } finally {
    prepare.mockRestore()
  }
}

const VERSION = { wallMs: NOW, counter: 0, deviceId: '0123456789abcdef' }

describe('a warmed ledger prepares no SQL', () => {
  test('in the store', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spend = aSpend(cash.id, food.id)

    const prepared = preparedOnSecondRun(ledger, () => {
      putDocument(ledger.db, { doc: cash, version: VERSION })
      putDocument(ledger.db, { doc: spend, version: VERSION })
      putDocument(ledger.db, { doc: tombstoneOf(spend), version: VERSION })
      getDocument(ledger.db, 'account', cash.id)
      getDocument(ledger.db, 'transaction', spend.id)
      countTransactionsUsing(ledger.db, cash.id)
      currenciesPostedTo(ledger.db, cash.id)
      pendingReferences(ledger.db)
      liveAccountAt(ledger.db, 'assets:cash')
    })

    expect(prepared).toBe(0)
  })

  test('in the outbox and the clock', () => {
    const ledger = tempLedger()
    const cash = anAccount()

    const prepared = preparedOnSecondRun(ledger, () => {
      enqueue(ledger.db, { doc: cash, version: VERSION })
      acknowledge(
        ledger.db,
        queued(ledger.db, 10).map((r) => r.rowId),
      )
      enqueue(ledger.db, { doc: cash, version: VERSION })
      supersede(ledger.db, 'account', cash.id)
      saveClock(ledger.db, loadClock(ledger.db))
    })

    expect(prepared).toBe(0)
  })

  // Every query a save or a receive makes: the checks on accounts, a lock, a deletion.
  test('in a save and a receive', () => {
    const ledger = tempLedger()
    const cash = anAccount({ currency: 'CAD' })
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spare = anAccount({ path: 'expenses:spare', kind: 'category' })
    ok(applyLocal(ledger, [cash, food, spare], NOW))
    let wallMs = NOW

    const prepared = preparedOnSecondRun(ledger, () => {
      const spend = aSpend(cash.id, food.id)
      // Unlocked, then locked again, so the lock is checked on every run, not just the first.
      const relock = [
        { ...food, currency: null },
        { ...food, currency: 'CAD' },
      ]
      ok(applyLocal(ledger, [spend, ...relock, { ...spare, deletedAt: NOW }], NOW))
      wallMs += 1000
      const edit = { ...spend, description: 'Edited there' }
      const there = { wallMs, counter: 0, deviceId: 'f0e1d2c3b4a59687' }
      expect(applyReceived(ledger, [{ doc: edit, version: there }], wallMs).refused).toEqual([])
    })

    expect(prepared).toBe(0)
  })

  test('in writing down a spend, editing it, and listing them', () => {
    const ledger = tempLedger()
    const ctx = contextFor({
      ledger,
      announce: () => {},
      time: { now: () => NOW, timeZone: () => 'UTC' },
    })
    let n = 0

    const prepared = preparedOnSecondRun(ledger, () => {
      const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
      n += 1
      ok(editSpend(ctx, { id, amount: String(n), description: 'Tea' }))
      listTransactions(ledger.db)
    })

    expect(prepared).toBe(0)
  })
})
