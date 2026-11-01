import { formatVersion } from '@have-fish/core/version'
import { readVersioned } from '@have-fish/core/versioned'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, test } from 'vitest'
import type { Ledger } from '../db/ledger'
import { outbox } from '../db/schema'
import { applyLocal } from './apply'
import { anAccount, aSpend, NOW, ok, tempLedger } from './fixtures'
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
