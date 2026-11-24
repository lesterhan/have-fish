import type { AccountKind } from '@have-fish/core/account-kind'
import {
  type DocumentOf,
  type DocumentTypeName,
  readDocument,
  type TransactionDoc,
} from '@have-fish/core/documents'
import { cents } from '@have-fish/core/money'
import { shapeOf } from '@have-fish/core/shapes'
import { expect, test } from 'vitest'
import { loadClock } from '../db/clock'
import {
  aLedgerOf,
  anAccount,
  aRate,
  aSpend,
  MAKER,
  NOW,
  ok,
  SYSTEM,
  tempLedger,
  tombstoneOf,
} from './fixtures'
import { getDocument } from './store'

test('the builders make documents readDocument accepts unchanged', () => {
  const cash = anAccount()
  const food = anAccount({ path: 'expenses:food', kind: 'category' })
  const spend = aSpend(cash.id, food.id)
  const fetched = aRate({
    published: '2026-11-04',
    origin: { source: 'system', createdAt: NOW, deviceId: MAKER },
  })
  for (const doc of [cash, food, spend, tombstoneOf(spend), aRate(), fetched]) {
    expect(ok(readDocument(doc))).toEqual(doc)
  }
})

test('aLedgerOf’s traveller profile writes a trip, an exchange from CAD and from USD, and a rate each day', () => {
  const ledger = tempLedger()
  aLedgerOf(280, ledger, 'traveller')

  const idsOf = (table: 'transactions' | 'rates') =>
    ledger.db
      .prepare<[], { id: string }>(`SELECT id FROM ${table}`)
      .all()
      .map(({ id }) => id)
  const read = <T extends DocumentTypeName>(type: T, id: string): DocumentOf<T> => {
    const found = getDocument(ledger.db, type, id)
    if (found === null) throw new Error(`no ${type} under ${id}`)
    return found.doc
  }
  const transactions = idsOf('transactions').map((id) => read('transaction', id))
  const rates = idsOf('rates').map((id) => read('rate', id))

  for (const doc of [...transactions, ...rates]) {
    expect(ok(readDocument(doc))).toEqual(doc)
  }

  const kindOf = new Map(
    ledger.db
      .prepare<[], { id: string; kind: AccountKind }>('SELECT id, kind FROM accounts')
      .all()
      .map((account) => [account.id, account.kind] as const),
  )
  const shapeOfDoc = (doc: TransactionDoc) =>
    shapeOf(
      doc.postings.map((p) => ({
        accountId: p.accountId,
        cents: cents(p.amount),
        currency: p.currency,
      })),
      (accountId) => kindOf.get(accountId),
    )
  const exchanged = transactions
    .map(shapeOfDoc)
    .flatMap((shape) => (shape.shape === 'exchange' ? [shape.from.currency] : []))
  expect(exchanged).toContain('CAD')
  expect(exchanged).toContain('USD')

  const fetched = rates.filter((rate) => rate.origin.source === 'system')
  expect(fetched).toHaveLength(20 * 6)
  expect(new Set(fetched.map((rate) => rate.from))).toEqual(
    new Set(['USD', 'EUR', 'CNY', 'JPY', 'GBP', 'MXN']),
  )
  for (const rate of fetched) {
    expect(rate.origin).toEqual(SYSTEM)
    expect(rate.published).toBe(rate.date)
  }
})

test('a temp ledger is new: a device id, a zero clock, no documents', () => {
  const ledger = tempLedger()
  expect(ledger.meta.deviceId).toMatch(/^[0-9a-f]{16}$/)
  expect(loadClock(ledger.db)).toEqual({ wallMs: 0, counter: 0 })
  expect(ledger.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0)
})
