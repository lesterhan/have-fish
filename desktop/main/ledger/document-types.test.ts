import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOCUMENT_TYPES } from '@have-fish/core/documents'
import { describe, expect, test, vi } from 'vitest'
import { applyLocal } from './apply'
import { STORED_TYPES } from './document-types'
import { anAccount, aSpend, NOW, ok, tempLedger, tombstoneOf } from './fixtures'
import { getDocument, putDocument } from './store'

const VERSION = { wallMs: NOW, counter: 0, deviceId: 'a1b2c3d4e5f60718' }

describe('STORED_TYPES', () => {
  test("has an entry for each of DOCUMENT_TYPES's types, and no other", () => {
    expect(Object.keys(STORED_TYPES).sort()).toEqual(Object.keys(DOCUMENT_TYPES).sort())
  })

  test('putDocument and getDocument round trip each type through its entry', () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const spend = aSpend(cash.id, anAccount().id)
    for (const doc of [cash, spend]) {
      const put = vi.spyOn(STORED_TYPES[doc.type], 'put')
      const get = vi.spyOn(STORED_TYPES[doc.type], 'get')
      putDocument(ledger.db, { doc, version: VERSION })
      expect(getDocument(ledger.db, doc.type, doc.id)).toEqual({ doc, version: VERSION })
      expect(put).toHaveBeenCalledOnce()
      expect(get).toHaveBeenCalledOnce()
    }
    vi.restoreAllMocks()
  })

  test("a transaction's checkEach refuses an account missing, deleted, or locked to another currency", () => {
    const ledger = tempLedger()
    const gone = anAccount({ deletedAt: NOW })
    const card = anAccount({ path: 'liabilities:card', kind: 'card', currency: 'CAD' })
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    ok(applyLocal(ledger, [gone, card, food], NOW))
    const { checkEach } = STORED_TYPES.transaction
    const missing = anAccount().id

    expect(checkEach(ledger.db, aSpend(missing, food.id))).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      details: { accountId: missing },
    })
    expect(checkEach(ledger.db, aSpend(gone.id, food.id))).toEqual({
      code: 'ACCOUNT_DELETED',
      details: { accountId: gone.id },
    })
    const euros = aSpend(card.id, food.id)
    euros.postings = euros.postings.map((p) => ({ ...p, currency: 'EUR' }))
    expect(checkEach(ledger.db, euros)).toEqual({
      code: 'ACCOUNT_CURRENCY_LOCKED',
      details: { accountId: card.id, currency: 'EUR', locked: 'CAD' },
    })
  })

  test("an account's checkEach passes any account", () => {
    const ledger = tempLedger()
    const { checkEach } = STORED_TYPES.account
    expect(checkEach(ledger.db, anAccount())).toBeNull()
    expect(checkEach(ledger.db, anAccount({ deletedAt: NOW, currency: 'EUR' }))).toBeNull()
  })

  test("an account's checkBatch refuses one in use or holding other currencies, and passes one deleted with its transactions", () => {
    const ledger = tempLedger()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spend = aSpend(cash.id, food.id)
    ok(applyLocal(ledger, [cash, food, spend], NOW))
    const { checkBatch } = STORED_TYPES.account
    const deleted = { ...food, deletedAt: NOW }

    expect(checkBatch(ledger.db, [{ at: 1, doc: deleted, previous: food }])).toEqual({
      at: 1,
      code: 'ACCOUNT_IN_USE',
      details: { accountId: food.id, transactions: 1 },
    })
    const locked = { ...cash, currency: 'EUR' }
    expect(checkBatch(ledger.db, [{ at: 2, doc: locked, previous: cash }])).toEqual({
      at: 2,
      code: 'ACCOUNT_HOLDS_OTHER_CURRENCIES',
      details: { accountId: cash.id, currencies: ['CAD'] },
    })
    putDocument(ledger.db, { doc: tombstoneOf(spend), version: VERSION })
    expect(checkBatch(ledger.db, [{ at: 1, doc: deleted, previous: food }])).toBeNull()
  })

  test("a transaction's checkBatch passes", () => {
    const ledger = tempLedger()
    const spend = aSpend(anAccount().id, anAccount().id)
    expect(
      STORED_TYPES.transaction.checkBatch(ledger.db, [{ at: 0, doc: spend, previous: null }]),
    ).toBeNull()
  })
})

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The two files that may ask a document's type what to do. */
const TABLES = ['core/src/documents.ts', 'desktop/main/ledger/document-types.ts']

const DISPATCH =
  /(?:===|!==|\s=)\s*'(?:account|transaction)'|\bcase\s+'(?:account|transaction)'\s*:/

/** Each line of `text` that chooses what to do by a document's type, as `file:line: code`. */
function dispatchIn(file: string, text: string): string[] {
  return text
    .split('\n')
    .flatMap((line, i) => (DISPATCH.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []))
}

const SOURCES = ['core/src', 'desktop/main']
  .flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f)),
  )
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !TABLES.includes(f))

describe('the guard on dispatch by type', () => {
  test('finds none outside the two tables', () => {
    expect(SOURCES).toEqual(expect.arrayContaining(['desktop/main/ledger/apply.ts']))
    const found = SOURCES.flatMap((f) => dispatchIn(f, readFileSync(join(ROOT, f), 'utf8')))
    expect(found).toEqual([])
  })

  test('names the file and line of a dispatch in another file', () => {
    const text = ['const a = 1', "if (doc.type === 'account') {", '}'].join('\n')
    expect(dispatchIn('desktop/main/elsewhere.ts', text)).toEqual([
      "desktop/main/elsewhere.ts:2: if (doc.type === 'account') {",
    ])
  })

  test("ignores 'account' in a command's To", () => {
    expect(dispatchIn('core/src/shapes.ts', "return 'account' in to ? to.account : null")).toEqual(
      [],
    )
  })
})
