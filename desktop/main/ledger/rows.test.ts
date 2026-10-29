import type { TransactionDoc } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import { describe, expect, test } from 'vitest'
import { rowsOf } from './rows'

const SPEND_ID = '00000000-0000-4000-8000-000000000001'
const CARD = '00000000-0000-4000-8000-0000000000a1'
const GROCERIES = '00000000-0000-4000-8000-0000000000a2'
const VERSION = { wallMs: Date.UTC(2026, 9, 29, 12), counter: 0, deviceId: '0123456789abcdef' }

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
})
