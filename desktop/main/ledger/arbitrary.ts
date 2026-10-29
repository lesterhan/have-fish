// Generators of valid documents, for property tests only. A test checks that `readVersioned`
// accepts everything these make, unchanged, so they can't drift from what "valid" means.

import { ACCOUNT_KINDS, type AccountKind, rootOf } from '@have-fish/core/account-kind'
import { CURRENCIES } from '@have-fish/core/currencies'
import type { AccountDoc, PostingDoc, TransactionDoc } from '@have-fish/core/documents'
import { format } from '@have-fish/core/money'
import { MAX_COUNTER, MAX_WALL_MS, type Version } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import fc from 'fast-check'

/** Up to five of these sum to well under the largest amount a posting can carry. */
const MAX_LEG_CENTS = 10 ** 11

export const version: fc.Arbitrary<Version> = fc.record({
  wallMs: fc.integer({ min: 0, max: MAX_WALL_MS }),
  counter: fc.integer({ min: 0, max: MAX_COUNTER }),
  deviceId: fc.stringMatching(/^[0-9a-f]{16}$/),
})

const date = fc
  .date({ min: new Date(Date.UTC(1900, 0, 1)), max: new Date(Date.UTC(2999, 11, 31)) })
  .filter((d) => !Number.isNaN(d.getTime()))
  .map((d) => d.toISOString().slice(0, 10))

// Whole graphemes, so any text a person can type, but never a lone surrogate.
const text = fc.string({ unit: 'grapheme', maxLength: 30 })

const deletedAt = fc.integer({ min: 0, max: MAX_WALL_MS })

// Everyday amounts as often as huge ones, which pass 2^31 cents.
const cents = fc.oneof(
  fc.integer({ min: -100_000, max: 100_000 }),
  fc.integer({ min: -MAX_LEG_CENTS, max: MAX_LEG_CENTS }),
)

/** One currency's legs: one to five amounts, then the leg that brings them to zero. */
function legsIn(currency: string, maxLegs: number): fc.Arbitrary<PostingDoc[]> {
  return fc
    .array(cents, {
      minLength: 1,
      maxLength: maxLegs - 1,
    })
    .chain((amounts) =>
      fc
        .array(fc.uuid(), { minLength: amounts.length + 1, maxLength: amounts.length + 1 })
        .map((accountIds) =>
          [...amounts, -amounts.reduce((a, b) => a + b, 0)].map((cents, i) => ({
            accountId: accountIds[i] ?? '',
            amount: format(cents),
            currency,
          })),
        ),
    )
}

/** Two to six legs in one to three currencies, each currency summing to zero, in any order. */
const postings: fc.Arbitrary<PostingDoc[]> = fc
  .uniqueArray(fc.constantFrom(...CURRENCIES), { minLength: 1, maxLength: 3 })
  .chain((currencies) => {
    const perCurrency = Math.floor(6 / currencies.length)
    return fc.tuple(...currencies.map((c) => legsIn(c, perCurrency)))
  })
  .chain((groups) => {
    const legs = groups.flat()
    return fc.shuffledSubarray(legs, { minLength: legs.length, maxLength: legs.length })
  })

// Keys in the schema's order, so a document compares equal as JSON text too.
const liveTransaction: fc.Arbitrary<TransactionDoc> = fc.record({
  type: fc.constant('transaction'),
  id: fc.uuid(),
  date,
  description: text,
  postings,
  deletedAt: fc.constant(null),
})

const tombstone: fc.Arbitrary<TransactionDoc> = fc.record({
  type: fc.constant('transaction'),
  id: fc.uuid(),
  date,
  description: text,
  postings: fc.constant([]),
  deletedAt,
})

/** Mostly live transactions, some tombstones. */
export const transaction: fc.Arbitrary<Versioned<TransactionDoc>> = fc.record({
  doc: fc.oneof({ arbitrary: liveTransaction, weight: 4 }, { arbitrary: tombstone, weight: 1 }),
  version,
})

const segment = text.filter((s) => s.length > 0 && s === s.trim() && !s.includes(':'))

const accountDoc: fc.Arbitrary<AccountDoc> = fc
  .tuple(fc.constantFrom(...ACCOUNT_KINDS), fc.array(segment, { minLength: 1, maxLength: 3 }))
  .chain(([kind, segments]: [AccountKind, string[]]) =>
    fc.record({
      type: fc.constant('account'),
      id: fc.uuid(),
      path: fc.constant([rootOf(kind), ...segments].join(':')),
      kind: fc.constant(kind),
      deletedAt: fc.option(deletedAt, { nil: null }),
    }),
  )

export const account: fc.Arbitrary<Versioned<AccountDoc>> = fc.record({
  doc: accountDoc,
  version,
})
