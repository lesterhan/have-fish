import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type Ledger, openLedger } from '../db/ledger'
import { account, transaction } from './arbitrary'
import { getDocument, putDocument } from './store'

// One real ledger file for the whole file: the runs put documents with random ids into it.
let root: string
let ledger: Ledger
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'havefish-store-'))
  const opened = openLedger({ dir: root, installId: 'install-a', now: Date.UTC(2026, 9, 29) })
  if (!opened.ok) throw new Error(`refused: ${opened.failure.code}`)
  ledger = opened.value
})
afterAll(() => {
  ledger.close()
  rmSync(root, { recursive: true, force: true })
})

const RUNS = { numRuns: 300 }

test('a new ledger file has the document tables, and refuses an amount as text', () => {
  const tables = ledger.db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)`)
    .pluck()
    .all('accounts', 'transactions', 'postings')
  expect(tables.sort()).toEqual(['accounts', 'postings', 'transactions'])

  const id = '00000000-0000-4000-8000-000000000001'
  ledger.db
    .prepare(
      `INSERT INTO transactions (id, date, description, version, originSource, originCreatedAt, originDeviceId) VALUES (?, '2026-10-29', '', 'v', 'manual', 0, '0123456789abcdef')`,
    )
    .run(id)
  const insertText = () =>
    ledger.db
      .prepare(
        `INSERT INTO postings (transactionId, position, accountId, amountCents, currency) VALUES (?, 0, ?, '12.50', 'CAD')`,
      )
      .run(id, id)
  expect(insertText).toThrow('postings_amount_cents_integer')
  ledger.db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
})

test('a transaction comes back from the file as the same JSON text', () => {
  fc.assert(
    fc.property(transaction, (v) => {
      putDocument(ledger.db, v)
      expect(JSON.stringify(getDocument(ledger.db, 'transaction', v.doc.id))).toBe(
        JSON.stringify(v),
      )
    }),
    RUNS,
  )
})

test('an account comes back from the file as the same JSON text', () => {
  fc.assert(
    fc.property(account, (v) => {
      putDocument(ledger.db, v)
      expect(JSON.stringify(getDocument(ledger.db, 'account', v.doc.id))).toBe(JSON.stringify(v))
    }),
    RUNS,
  )
})

test("SQL sums a transaction's postings to zero in each currency", () => {
  const sums = ledger.db.prepare(
    'SELECT currency, sum(amountCents) AS total FROM postings WHERE transactionId = ? GROUP BY currency',
  )
  fc.assert(
    fc.property(transaction, (v) => {
      putDocument(ledger.db, v)
      for (const { total } of sums.all(v.doc.id) as { total: number }[]) expect(total).toBe(0)
    }),
    RUNS,
  )
})
