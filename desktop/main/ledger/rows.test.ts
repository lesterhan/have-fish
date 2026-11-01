import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import { describe, expect, test } from 'vitest'
import { docOf, rowsOf } from './rows'

const SPEND_ID = '00000000-0000-4000-8000-000000000001'
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000002'
const CARD = '00000000-0000-4000-8000-0000000000a1'
const GROCERIES = '00000000-0000-4000-8000-0000000000a2'
const CONVERSION = '00000000-0000-4000-8000-0000000000a3'
const VERSION = { wallMs: Date.UTC(2026, 9, 29, 12), counter: 0, deviceId: '0123456789abcdef' }
const MADE = { createdAt: Date.UTC(2026, 9, 28, 9), deviceId: 'feedfacecafebeef' }
const MANUAL = { source: 'manual', ...MADE } as const
const IMPORTED = {
  source: 'import',
  ...MADE,
  file: 'td-oct.csv',
  line: 15,
  text: 'Alp**Mannerswudaokou',
} as const

const SPEND: Versioned<TransactionDoc> = {
  doc: {
    type: 'transaction',
    id: SPEND_ID,
    date: '2026-10-29',
    description: 'Groceries',
    postings: [
      { accountId: CARD, amount: '-12.50', currency: 'CAD' },
      { accountId: GROCERIES, amount: '12.50', currency: 'CAD' },
    ],
    deletedAt: null,
    origin: MANUAL,
  },
  version: VERSION,
}

const ACCOUNT: Versioned<AccountDoc> = {
  doc: {
    type: 'account',
    id: ACCOUNT_ID,
    path: 'assets:CASH',
    kind: 'cash',
    deletedAt: null,
    origin: { source: 'system', ...MADE },
  },
  version: VERSION,
}

describe('rowsOf', () => {
  test('a two-leg spend is a transaction row and a posting row per leg, in order', () => {
    expect(rowsOf(SPEND)).toEqual({
      transaction: {
        id: SPEND_ID,
        date: '2026-10-29',
        description: 'Groceries',
        deletedAt: null,
        version: '2026-10-29T12:00:00.000Z-0000-0123456789abcdef',
        originSource: 'manual',
        originCreatedAt: MADE.createdAt,
        originDeviceId: 'feedfacecafebeef',
        originFile: null,
        originLine: null,
        originText: null,
      },
      postings: [
        {
          transactionId: SPEND_ID,
          position: 0,
          accountId: CARD,
          amountCents: -1250,
          currency: 'CAD',
        },
        {
          transactionId: SPEND_ID,
          position: 1,
          accountId: GROCERIES,
          amountCents: 1250,
          currency: 'CAD',
        },
      ],
    })
  })

  test('account pathKey is lowercased, path is unchanged', () => {
    expect(rowsOf(ACCOUNT)).toEqual({
      account: {
        id: ACCOUNT_ID,
        deletedAt: null,
        path: 'assets:CASH',
        kind: 'cash',
        version: '2026-10-29T12:00:00.000Z-0000-0123456789abcdef',
        pathKey: 'assets:cash',
        originSource: 'system',
        originCreatedAt: MADE.createdAt,
        originDeviceId: 'feedfacecafebeef',
        originFile: null,
        originLine: null,
        originText: null,
      },
    })
  })

  test("an import's file, line and text fill their columns", () => {
    const { transaction } = rowsOf({ ...SPEND, doc: { ...SPEND.doc, origin: IMPORTED } })
    expect(transaction).toMatchObject({
      originSource: 'import',
      originCreatedAt: MADE.createdAt,
      originDeviceId: 'feedfacecafebeef',
      originFile: 'td-oct.csv',
      originLine: 15,
      originText: 'Alp**Mannerswudaokou',
    })
  })
})

describe('docOf', () => {
  test('transaction round trip does not change a document', () => {
    const { transaction, postings } = rowsOf(SPEND)
    expect(docOf(transaction, postings)).toEqual(SPEND)
  })

  test.each([
    ['manual', MANUAL],
    ['import', IMPORTED],
    ['system', { source: 'system', ...MADE } as const],
  ])('a %s transaction comes back as it went in', (_title, origin) => {
    const spend = { ...SPEND, doc: { ...SPEND.doc, origin } }
    const { transaction, postings } = rowsOf(spend)
    expect(docOf(transaction, postings)).toEqual(spend)
  })

  test('account round trip does not change a document', () => {
    const { account } = rowsOf(ACCOUNT)
    expect(docOf(account)).toEqual(ACCOUNT)
  })

  test('tombstoned doc has no postings, return unchanged', () => {
    const deletedAt = Date.UTC(2026, 9, 30)
    const tombstonedDoc = {
      ...SPEND.doc,
      deletedAt,
      postings: [],
    }
    const tombstonedSpend = {
      ...SPEND,
      doc: tombstonedDoc,
    }
    const { transaction, postings } = rowsOf(tombstonedSpend)
    const doc = docOf(transaction, postings)
    expect(doc).toEqual({ doc: tombstonedDoc, version: VERSION })
    expect(postings).toEqual([])
  })

  test('tombstoned account has deletedAt', () => {
    const deletedAt = Date.UTC(2026, 9, 30)
    const tombstonedDoc = {
      ...ACCOUNT.doc,
      deletedAt,
    }
    const tombstonedAccount = {
      ...ACCOUNT,
      doc: tombstonedDoc,
    }
    const { account } = rowsOf(tombstonedAccount)
    const doc = docOf(account)
    expect(doc).toEqual({ doc: tombstonedDoc, version: VERSION })
  })

  test('a four-leg conversion with no description comes back as it went in', () => {
    const conversion: Versioned<TransactionDoc> = {
      ...SPEND,
      doc: {
        ...SPEND.doc,
        description: '',
        postings: [
          { accountId: CARD, amount: '-13.70', currency: 'CAD' },
          { accountId: CONVERSION, amount: '13.70', currency: 'CAD' },
          { accountId: CONVERSION, amount: '-10.00', currency: 'USD' },
          { accountId: GROCERIES, amount: '10.00', currency: 'USD' },
        ],
      },
    }
    const { transaction, postings } = rowsOf(conversion)
    expect(transaction.description).toBe('')
    expect(docOf(transaction, postings)).toEqual(conversion)
  })

  test('postings come back in position order, whatever order the rows arrive in', () => {
    const { transaction, postings } = rowsOf(SPEND)
    expect(docOf(transaction, postings.toReversed())).toEqual(SPEND)
  })

  test('a row whose version does not parse is refused, naming the row', () => {
    const { transaction, postings } = rowsOf(SPEND)
    expect(() => docOf({ ...transaction, version: 'not a version' }, postings)).toThrow(
      `${SPEND_ID} has "not a version"`,
    )
    const { account } = rowsOf(ACCOUNT)
    expect(() => docOf({ ...account, version: '' })).toThrow(`${ACCOUNT_ID} has ""`)
  })

  test('an imported row without its file, line or text is refused, naming the row', () => {
    const { transaction, postings } = rowsOf({ ...SPEND, doc: { ...SPEND.doc, origin: IMPORTED } })
    for (const missing of ['originFile', 'originLine', 'originText'] as const) {
      expect(() => docOf({ ...transaction, [missing]: null }, postings)).toThrow(
        `${SPEND_ID} is an import without its file, line or text`,
      )
    }
  })

  test('an account row that says it was imported is refused, naming the row', () => {
    const { account } = rowsOf(ACCOUNT)
    expect(() => docOf({ ...account, originSource: 'import' })).toThrow(`${ACCOUNT_ID} is imported`)
  })
})
