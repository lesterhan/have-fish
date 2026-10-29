import type { LedgerDocument } from '@have-fish/core/documents'
import type { Versioned } from '@have-fish/core/versioned'
import { readVersioned } from '@have-fish/core/versioned'
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { account, transaction } from './arbitrary'
import { docOf, rowsOf } from './rows'

const RUNS = { numRuns: 300 }

test.each([
  ['transactions', transaction],
  ['accounts', account],
] as const)(
  'the generated %s are valid documents, as readVersioned would return them',
  (_, arb) => {
    fc.assert(
      fc.property(arb, (v: Versioned<LedgerDocument>) => {
        expect(readVersioned(JSON.parse(JSON.stringify(v)))).toEqual({ ok: true, value: v })
      }),
      RUNS,
    )
  },
)

test('a transaction comes back from its rows as the same JSON text', () => {
  fc.assert(
    fc.property(transaction, (v) => {
      const { transaction: row, postings } = rowsOf(v)
      expect(JSON.stringify(docOf(row, postings))).toBe(JSON.stringify(v))
    }),
    RUNS,
  )
})

test('an account comes back from its row as the same JSON text', () => {
  fc.assert(
    fc.property(account, (v) => {
      expect(JSON.stringify(docOf(rowsOf(v).account))).toBe(JSON.stringify(v))
    }),
    RUNS,
  )
})
