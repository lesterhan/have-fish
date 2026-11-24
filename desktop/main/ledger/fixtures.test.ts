import type { AccountKind } from '@have-fish/core/account-kind'
import { fitsCurrency } from '@have-fish/core/currencies'
import {
  type DocumentOf,
  type DocumentTypeName,
  readDocument,
  type TransactionDoc,
} from '@have-fish/core/documents'
import { cents } from '@have-fish/core/money'
import { shapeOf } from '@have-fish/core/shapes'
import { describe, expect, test } from 'vitest'
import { loadClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
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

describe('aLedgerOf', () => {
  /** Every transaction and rate `ledger` holds, read back from its rows. */
  function documentsIn(ledger: Ledger) {
    const read = <T extends DocumentTypeName>(type: T, id: string): DocumentOf<T> => {
      const found = getDocument(ledger.db, type, id)
      if (found === null) throw new Error(`no ${type} under ${id}`)
      return found.doc
    }
    const idsOf = (table: 'transactions' | 'rates') =>
      ledger.db
        .prepare<[], { id: string }>(`SELECT id FROM ${table}`)
        .all()
        .map(({ id }) => id)
    return {
      transactions: idsOf('transactions').map((id) => read('transaction', id)),
      rates: idsOf('rates').map((id) => read('rate', id)),
    }
  }

  /** What each transaction is, from its postings and the kind of each one's account. */
  function shapesIn(ledger: Ledger, transactions: readonly TransactionDoc[]) {
    const kindOf = new Map(
      ledger.db
        .prepare<[], { id: string; kind: AccountKind }>('SELECT id, kind FROM accounts')
        .all()
        .map((account) => [account.id, account.kind] as const),
    )
    return transactions.map((doc) =>
      shapeOf(
        doc.postings.map((p) => ({
          accountId: p.accountId,
          cents: cents(p.amount),
          currency: p.currency,
        })),
        (accountId) => kindOf.get(accountId),
      ),
    )
  }

  test('a traveller profile writes a trip, an exchange from CAD and from USD, and a rate each day', () => {
    const ledger = tempLedger()
    aLedgerOf(280, ledger, 'traveller')
    const { transactions, rates } = documentsIn(ledger)

    for (const doc of [...transactions, ...rates]) {
      expect(ok(readDocument(doc))).toEqual(doc)
    }

    const exchanged = shapesIn(ledger, transactions).flatMap((shape) =>
      shape.shape === 'exchange' ? [shape.from.currency] : [],
    )
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

  test('a traveller profile fits each currency at every trip, the yen’s whole amounts too', () => {
    const ledger = tempLedger()
    aLedgerOf(3_556, ledger, 'traveller')
    const { transactions } = documentsIn(ledger)

    const unfit = transactions
      .flatMap((doc) => doc.postings)
      .filter((p) => !fitsCurrency(cents(p.amount), p.currency))
    expect(unfit).toEqual([])

    const spentIn = shapesIn(ledger, transactions).flatMap((shape) =>
      shape.shape === 'spend' ? [shape.from.currency] : [],
    )
    expect(['EUR', 'CNY', 'JPY', 'GBP', 'MXN'].filter((c) => !spentIn.includes(c))).toEqual([])
  })

  test('280 with no profile writes home’s postings, account by account, as it did before', () => {
    const ledger = tempLedger()
    aLedgerOf(280, ledger)
    const pinned = ledger.db
      .prepare<[], { path: string; postings: number; cents: number }>(
        `SELECT a.path AS path, count(*) AS postings, sum(p.amountCents) AS cents
         FROM postings p JOIN accounts a ON a.id = p.accountId
         GROUP BY a.path ORDER BY a.path`,
      )
      .all()

    expect(pinned).toEqual([
      { path: 'assets:chequing', postings: 101, cents: 1_417_500 },
      { path: 'equity:opening', postings: 2, cents: 0 },
      { path: 'expenses:books', postings: 47, cents: 58_750 },
      { path: 'expenses:food', postings: 43, cents: 53_750 },
      { path: 'expenses:gifts', postings: 46, cents: 57_500 },
      { path: 'expenses:rent', postings: 47, cents: 58_750 },
      { path: 'expenses:transit', postings: 43, cents: 53_750 },
      { path: 'expenses:travel', postings: 44, cents: 55_000 },
      { path: 'income:salary', postings: 10, cents: -1_500_000 },
      { path: 'liabilities:visa', postings: 181, cents: -255_000 },
    ])
    expect(ledger.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(282)
  })
})

test('a temp ledger is new: a device id, a zero clock, no documents', () => {
  const ledger = tempLedger()
  expect(ledger.meta.deviceId).toMatch(/^[0-9a-f]{16}$/)
  expect(loadClock(ledger.db)).toEqual({ wallMs: 0, counter: 0 })
  expect(ledger.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0)
})
