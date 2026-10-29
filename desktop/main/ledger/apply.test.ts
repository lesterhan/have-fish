import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import { compareVersions } from '@have-fish/core/version'
import { describe, expect, test } from 'vitest'
import { loadClock } from '../db/clock'
import type { Ledger } from '../db/ledger'
import { applyLocal } from './apply'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from './fixtures'
import { getDocument, putDocument } from './store'

const count = (ledger: Ledger, table: string) =>
  ledger.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()

/** A ledger holding a cash account and a food category, applied locally. */
function withAccounts(): { ledger: Ledger; cash: AccountDoc; food: AccountDoc } {
  const ledger = tempLedger()
  const cash = anAccount()
  const food = anAccount({ path: 'expenses:food', kind: 'category' })
  ok(applyLocal(ledger, [cash, food], NOW))
  return { ledger, cash, food }
}

describe('applyLocal, one document', () => {
  test("a new spend is written, with a version carrying the file's device id", () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id)

    const applied = ok(applyLocal(ledger, [spend], NOW))

    const stored = getDocument(ledger.db, 'transaction', spend.id)
    expect(stored?.doc).toEqual(spend)
    expect(stored?.version.deviceId).toBe(ledger.meta.deviceId)
    expect(applied).toEqual({
      written: [{ type: 'transaction', id: spend.id, version: stored?.version }],
      same: 0,
      stale: 0,
      refused: [],
    })
  })

  test('the clock is saved at the last version written', () => {
    const { ledger, cash, food } = withAccounts()
    const applied = ok(applyLocal(ledger, [aSpend(cash.id, food.id)], NOW))
    const [written] = applied.written
    expect(loadClock(ledger.db)).toEqual({
      wallMs: written?.version.wallMs,
      counter: written?.version.counter,
    })
  })

  test('an edit writes a newer version, and the stored postings are the edit’s', () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id, '12.50')
    const first = ok(applyLocal(ledger, [spend], NOW)).written[0]
    const edit: TransactionDoc = { ...aSpend(cash.id, food.id, '30.00'), id: spend.id }

    const second = ok(applyLocal(ledger, [edit], NOW)).written[0]

    expect(second?.version).toEqual({
      ...first?.version,
      counter: (first?.version.counter ?? 0) + 1,
    })
    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc).toEqual(edit)
    expect(count(ledger, 'postings')).toBe(2)
  })

  test('a delete stores a tombstone with no postings, and an undelete brings it back', () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [spend], NOW))

    ok(applyLocal(ledger, [tombstoneOf(spend)], NOW + 1000))
    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc).toEqual(tombstoneOf(spend))
    expect(count(ledger, 'postings')).toBe(0)

    ok(applyLocal(ledger, [spend], NOW + 2000))
    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc).toEqual(spend)
    expect(count(ledger, 'postings')).toBe(2)
  })

  test('amounts are stored in their canonical form', () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id, '12.5')
    ok(applyLocal(ledger, [spend], NOW))
    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc.postings[1]?.amount).toBe('12.50')
  })

  test('a malformed document is refused with its place in the batch, and nothing moves', () => {
    const { ledger, cash, food } = withAccounts()
    const clock = loadClock(ledger.db)
    const unbalanced = aSpend(cash.id, food.id)
    unbalanced.postings[1] = { accountId: food.id, amount: '12.49', currency: 'CAD' }

    const outcome = applyLocal(ledger, [aSpend(cash.id, food.id), unbalanced], NOW)

    expect(outcome).toEqual({
      ok: false,
      failure: { at: 1, code: 'POSTINGS_DO_NOT_BALANCE', details: { currency: 'CAD', cents: -1 } },
    })
    expect(count(ledger, 'transactions')).toBe(0)
    expect(loadClock(ledger.db)).toEqual(clock)
  })

  test('a stored version the clock never saw throws, rather than dropping the edit', () => {
    const { ledger, cash, food } = withAccounts()
    const spend = aSpend(cash.id, food.id)
    const future = { wallMs: NOW + 3_600_000, counter: 0, deviceId: '0123456789abcdef' }
    putDocument(ledger.db, { doc: spend, version: future })

    expect(() => applyLocal(ledger, [{ ...spend, description: 'Edited' }], NOW)).toThrow(
      'A local version lost',
    )
    expect(getDocument(ledger.db, 'transaction', spend.id)?.doc).toEqual(spend)
  })
})

describe('applyLocal, a batch', () => {
  test('an account and a spend that uses it apply together, in either order', () => {
    for (const order of ['account first', 'spend first']) {
      const ledger = tempLedger()
      const cash = anAccount()
      const food = anAccount({ path: 'expenses:food', kind: 'category' })
      const spend = aSpend(cash.id, food.id)
      const batch = order === 'account first' ? [cash, food, spend] : [spend, cash, food]

      const applied = ok(applyLocal(ledger, batch, NOW))

      expect(applied.written.map((w) => w.type)).toEqual(['account', 'account', 'transaction'])
      expect(getDocument(ledger.db, 'transaction', spend.id)?.doc).toEqual(spend)
    }
  })

  test('1,000 documents with time frozen get strictly increasing versions', () => {
    const { ledger, cash, food } = withAccounts()
    const spends = Array.from({ length: 1000 }, () => aSpend(cash.id, food.id))

    const { written } = ok(applyLocal(ledger, spends, NOW))

    expect(written).toHaveLength(1000)
    for (let i = 1; i < written.length; i++) {
      const [before, after] = [written[i - 1]?.version, written[i]?.version]
      expect(before && after && compareVersions(before, after)).toBe(-1)
    }
    expect(count(ledger, 'transactions')).toBe(1000)
  })
})
