import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AccountDoc, readDocument, type TransactionDoc } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { migrate } from '../db/migrate'
import { MIGRATIONS } from '../db/migrations'
import { getDocument, putDocument } from './store'

const NOW = Date.UTC(2026, 9, 29, 12)
const SPEND_ID = '00000000-0000-4000-8000-000000000001'
const CARD = '00000000-0000-4000-8000-0000000000a1'
const GROCERIES = '00000000-0000-4000-8000-0000000000a2'
const RESTAURANTS = '00000000-0000-4000-8000-0000000000a3'
const V1 = { wallMs: NOW, counter: 0, deviceId: '0123456789abcdef' }
const V2 = { ...V1, counter: 1 }
const MANUAL = { source: 'manual', createdAt: NOW, deviceId: 'feedfacecafebeef' } as const

const SPEND: Versioned<TransactionDoc> = {
  doc: {
    type: 'transaction',
    id: SPEND_ID,
    date: '2026-10-29',
    description: 'Groceries',
    postings: [
      { accountId: CARD, amount: '-30.00', currency: 'CAD' },
      { accountId: GROCERIES, amount: '20.00', currency: 'CAD' },
      { accountId: RESTAURANTS, amount: '10.00', currency: 'CAD' },
    ],
    deletedAt: null,
    origin: MANUAL,
  },
  version: V1,
}

const cash = (id: string): Versioned<AccountDoc> => ({
  doc: { type: 'account', id, path: 'assets:cash', kind: 'cash', deletedAt: null, origin: MANUAL },
  version: V1,
})

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  migrate(db, MIGRATIONS, NOW, join(tmpdir(), 'havefish-never-written'))
})
afterEach(() => db.close())

const count = (table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()

describe('putDocument and getDocument', () => {
  test('a transaction comes back as it went in', () => {
    putDocument(db, SPEND)
    expect(getDocument(db, 'transaction', SPEND_ID)).toEqual(SPEND)
  })

  test('an account comes back as it went in', () => {
    putDocument(db, cash(CARD))
    expect(getDocument(db, 'account', CARD)).toEqual(cash(CARD))
  })

  const SYSTEM = { ...MANUAL, source: 'system' } as const
  const IMPORTED = {
    ...MANUAL,
    source: 'import',
    file: 'td-oct.csv',
    line: 15,
    text: 'Alp**Mannerswudaokou',
  } as const

  test.each([
    ['manual transaction', SPEND.doc, MANUAL],
    ['imported transaction', SPEND.doc, IMPORTED],
    ['system transaction', SPEND.doc, SYSTEM],
    ['manual account', cash(CARD).doc, MANUAL],
    ['system account', cash(CARD).doc, SYSTEM],
  ] as const)('a %s comes back as readDocument read it', (_title, doc, origin) => {
    const read = readDocument({ ...doc, origin })
    if (!read.ok) throw new Error(JSON.stringify(read.failure))
    putDocument(db, { doc: read.value, version: V1 })
    expect(getDocument(db, read.value.type, doc.id)).toEqual({ doc: read.value, version: V1 })
  })

  test('an unknown id, or one of the other type, is null', () => {
    putDocument(db, SPEND)
    putDocument(db, cash(CARD))
    expect(getDocument(db, 'transaction', GROCERIES)).toBeNull()
    expect(getDocument(db, 'account', SPEND_ID)).toBeNull()
    expect(getDocument(db, 'transaction', CARD)).toBeNull()
  })

  test('putting the same id with fewer postings leaves only the new ones', () => {
    putDocument(db, SPEND)
    const twoLegs: Versioned<TransactionDoc> = {
      doc: {
        ...SPEND.doc,
        postings: [
          { accountId: CARD, amount: '-30.00', currency: 'CAD' },
          { accountId: GROCERIES, amount: '30.00', currency: 'CAD' },
        ],
      },
      version: V2,
    }
    putDocument(db, twoLegs)

    expect(count('postings')).toBe(2)
    expect(getDocument(db, 'transaction', SPEND_ID)).toEqual(twoLegs)
  })

  test('a tombstone over a live transaction removes its postings, and keeps its row', () => {
    putDocument(db, SPEND)
    const tombstone: Versioned<TransactionDoc> = {
      doc: { ...SPEND.doc, postings: [], deletedAt: NOW },
      version: V2,
    }
    putDocument(db, tombstone)

    expect(count('postings')).toBe(0)
    expect(count('transactions')).toBe(1)
    expect(getDocument(db, 'transaction', SPEND_ID)).toEqual(tombstone)
  })

  test('a posting to an account the file lacks is stored', () => {
    expect(count('accounts')).toBe(0)
    putDocument(db, SPEND)
    expect(getDocument(db, 'transaction', SPEND_ID)).toEqual(SPEND)
  })

  test('two accounts with the same path are both stored', () => {
    putDocument(db, cash(CARD))
    putDocument(db, cash(GROCERIES))
    expect(count('accounts')).toBe(2)
  })

  test('putting an account again replaces it', () => {
    putDocument(db, cash(CARD))
    const deleted: Versioned<AccountDoc> = {
      doc: { ...cash(CARD).doc, deletedAt: NOW },
      version: V2,
    }
    putDocument(db, deleted)
    expect(count('accounts')).toBe(1)
    expect(getDocument(db, 'account', CARD)).toEqual(deleted)
  })
})

describe('a failed put', () => {
  // Makes the posting insert fail, after the root row is already written.
  const breakPostings = () =>
    db.exec(`CREATE TRIGGER fail BEFORE INSERT ON postings BEGIN SELECT RAISE(ABORT, 'boom'); END`)

  test('leaves no transaction behind', () => {
    breakPostings()
    expect(() => putDocument(db, SPEND)).toThrow('boom')
    expect(count('transactions')).toBe(0)
  })

  test('leaves the previous version whole', () => {
    putDocument(db, SPEND)
    breakPostings()
    const edit: Versioned<TransactionDoc> = {
      doc: { ...SPEND.doc, description: 'Edited' },
      version: V2,
    }
    expect(() => putDocument(db, edit)).toThrow('boom')
    expect(getDocument(db, 'transaction', SPEND_ID)).toEqual(SPEND)
  })

  test("inside a caller's transaction, rolls back with it", () => {
    const fail = db.transaction(() => {
      putDocument(db, SPEND)
      throw new Error('the caller changed its mind')
    })
    expect(fail).toThrow('changed its mind')
    expect(count('transactions')).toBe(0)
    expect(count('postings')).toBe(0)
  })
})
