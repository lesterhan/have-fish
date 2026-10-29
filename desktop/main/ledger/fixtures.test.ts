import { readDocument } from '@have-fish/core/documents'
import { expect, test } from 'vitest'
import { loadClock } from '../db/clock'
import { anAccount, aSpend, ok, tempLedger, tombstoneOf } from './fixtures'

test('the builders make documents readDocument accepts unchanged', () => {
  const cash = anAccount()
  const food = anAccount({ path: 'expenses:food', kind: 'category' })
  const spend = aSpend(cash.id, food.id)
  for (const doc of [cash, food, spend, tombstoneOf(spend)]) {
    expect(ok(readDocument(doc))).toEqual(doc)
  }
})

test('a temp ledger is new: a device id, a zero clock, no documents', () => {
  const ledger = tempLedger()
  expect(ledger.meta.deviceId).toMatch(/^[0-9a-f]{16}$/)
  expect(loadClock(ledger.db)).toEqual({ wallMs: 0, counter: 0 })
  expect(ledger.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0)
})
