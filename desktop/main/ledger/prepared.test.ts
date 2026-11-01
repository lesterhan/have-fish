// Once each query has run, the ledger's work prepares no more SQL: every statement is built once
// per open file and reused.

import { describe, expect, test, vi } from 'vitest'
import { loadClock, saveClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
import { anAccount, aSpend, NOW, tempLedger, tombstoneOf } from './fixtures'
import { acknowledge, enqueue, queued, supersede } from './outbox'
import {
  countTransactionsUsing,
  currenciesPostedTo,
  getDocument,
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
})
