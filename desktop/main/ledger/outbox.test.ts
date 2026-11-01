import { formatVersion, type Version } from '@have-fish/core/version'
import { readVersioned } from '@have-fish/core/versioned'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, test } from 'vitest'
import type { Ledger } from '../db/ledger'
import { outbox } from '../db/schema'
import { applyLocal, applyReceived } from './apply'
import { anAccount, aSpend, NOW, ok, tempLedger } from './fixtures'
import { acknowledge, queued } from './outbox'
import { getDocument } from './store'

/** Every row the outbox holds, in rowId order. */
const allRows = (ledger: Ledger) =>
  drizzle(ledger.db).select().from(outbox).orderBy(outbox.rowId).all()

/** The rows queued for one document. */
const rowsFor = (ledger: Ledger, docId: string) =>
  drizzle(ledger.db).select().from(outbox).where(eq(outbox.docId, docId)).all()

/** A ledger holding a cash account and a food category, applied locally. */
function withAccounts() {
  const ledger = tempLedger()
  const cash = anAccount()
  const food = anAccount({ path: 'expenses:food', kind: 'category' })
  ok(applyLocal(ledger, [cash, food], NOW))
  return { ledger, cash, food }
}

describe('a local write', () => {
  test('leaves one row, whose body reads back as what the file holds', () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id, '12.5')

    ok(applyLocal(ledger, [spend], NOW))

    const [row, ...rest] = rowsFor(ledger, spend.id)
    expect(rest).toEqual([])
    const stored = getDocument(ledger.db, 'transaction', spend.id)
    expect(row?.docType).toBe('transaction')
    expect(row?.version).toBe(stored && formatVersion(stored.version))
    expect(readVersioned(JSON.parse(row?.body ?? 'null'))).toEqual({ ok: true, value: stored })
  })

  test('of an account queues it too', () => {
    const { ledger, cash, food } = withAccounts()
    expect(rowsFor(ledger, cash.id).map((r) => r.docType)).toEqual(['account'])
    expect(rowsFor(ledger, food.id).map((r) => r.docType)).toEqual(['account'])
  })

  test('three edits of one spend leave one row: the last version, under a new rowId', () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [spend], NOW))
    const [first] = rowsFor(ledger, spend.id)

    for (const amount of ['20.00', '30.00']) {
      ok(applyLocal(ledger, [aSpend(cash.id, food.id, amount, { id: spend.id })], NOW))
    }

    const rows = rowsFor(ledger, spend.id)
    const stored = getDocument(ledger.db, 'transaction', spend.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.version).toBe(stored && formatVersion(stored.version))
    expect(rows[0]?.rowId).not.toBe(first?.rowId)
    expect(JSON.parse(rows[0]?.body ?? 'null').doc.postings[1].amount).toBe('30.00')
  })

  test('in a refused batch leaves the outbox as it was', () => {
    const { ledger, cash, food } = withAccounts()
    ok(applyLocal(ledger, [aSpend(cash.id, food.id)], NOW))
    const before = allRows(ledger)

    // The new account and the first spend are fine; the second posts to an account the file lacks.
    const card = anAccount({ path: 'liabilities:card', kind: 'card' })
    const refused = applyLocal(
      ledger,
      [card, aSpend(card.id, food.id), aSpend(anAccount().id, food.id)],
      NOW,
    )

    expect(refused).toMatchObject({ ok: false, failure: { at: 2, code: 'ACCOUNT_NOT_FOUND' } })
    expect(allRows(ledger)).toEqual(before)
  })
})

/** Another device's id. */
const THERE = 'f0e1d2c3b4a59687'
const there = (wallMs: number): Version => ({ wallMs, counter: 0, deviceId: THERE })

describe('a received document', () => {
  /** A ledger with a spend queued locally at `NOW`. */
  function withQueuedSpend() {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [spend], NOW))
    return { ledger, spend }
  }

  test('a newer version deletes the queued row for its document, and only that one', () => {
    const { ledger, spend } = withQueuedSpend()
    const others = allRows(ledger).filter((r) => r.docId !== spend.id)

    const edit = { doc: { ...spend, description: 'Edited there' }, version: there(NOW + 1000) }
    expect(applyReceived(ledger, [edit], NOW).written).toHaveLength(1)

    expect(rowsFor(ledger, spend.id)).toEqual([])
    expect(allRows(ledger)).toEqual(others)
  })

  test('the same version, or an older one, leaves the queued row', () => {
    const { ledger, spend } = withQueuedSpend()
    const before = allRows(ledger)
    const queued = getDocument(ledger.db, 'transaction', spend.id)
    if (queued === null) throw new Error('not stored')
    const older = { doc: { ...spend, description: 'Older' }, version: there(NOW - 1000) }

    expect(applyReceived(ledger, [queued, older], NOW)).toMatchObject({ same: 1, stale: 1 })

    expect(allRows(ledger)).toEqual(before)
  })

  test('on its own never adds a row', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const received = [cash, food, aSpend(cash.id, food.id)].map((doc) => ({
      doc,
      version: there(NOW),
    }))

    expect(applyReceived(ledger, received, NOW).written).toHaveLength(3)

    expect(allRows(ledger)).toEqual([])
  })
})

describe('queued', () => {
  test('lists accounts before transactions, then by version, and honours the limit', () => {
    const { ledger, cash, food } = withAccounts()
    const first = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [first], NOW))
    const card = anAccount({ path: 'liabilities:card', kind: 'card' })
    ok(applyLocal(ledger, [card], NOW))
    const second = aSpend(card.id, food.id)
    ok(applyLocal(ledger, [second], NOW))

    const order = [cash.id, food.id, card.id, first.id, second.id]
    expect(queued(ledger.db, 10).map((r) => r.docId)).toEqual(order)
    expect(queued(ledger.db, 4).map((r) => r.docId)).toEqual(order.slice(0, 4))
    expect(queued(ledger.db, 0)).toEqual([])
  })

  test('returns the rows as stored', () => {
    const { ledger } = withAccounts()
    expect(queued(ledger.db, 10)).toEqual(
      allRows(ledger).toSorted((a, b) => (a.version < b.version ? -1 : 1)),
    )
  })
})

describe('acknowledge', () => {
  test('deletes the rows it names, and ignores a rowId it doesn’t hold', () => {
    const { ledger, cash, food } = withAccounts()
    const [cashRow] = rowsFor(ledger, cash.id)

    acknowledge(ledger.db, [cashRow?.rowId ?? '', 'not-a-row'])

    expect(queued(ledger.db, 10).map((r) => r.docId)).toEqual([food.id])
    acknowledge(ledger.db, [])
    expect(queued(ledger.db, 10).map((r) => r.docId)).toEqual([food.id])
  })

  test('of a row an edit has since replaced leaves the edit queued', () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [spend], NOW))
    // Sync reads the spend's row and starts pushing it.
    const [pushing] = rowsFor(ledger, spend.id)

    // You edit the spend while the push is in flight; then the relay acknowledges the old row.
    ok(applyLocal(ledger, [{ ...spend, description: 'Edited' }], NOW))
    acknowledge(ledger.db, [pushing?.rowId ?? ''])

    const [row, ...rest] = rowsFor(ledger, spend.id)
    expect(rest).toEqual([])
    expect(JSON.parse(row?.body ?? 'null').doc.description).toBe('Edited')
  })
})
