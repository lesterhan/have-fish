// Generators of valid documents, for property tests only. A test checks that `readVersioned`
// accepts everything these make, unchanged, so they can't drift from what "valid" means.

import { ACCOUNT_KINDS, type AccountKind, rootOf } from '@have-fish/core/account-kind'
import { CURRENCIES } from '@have-fish/core/currencies'
import type {
  AccountDoc,
  AccountOrigin,
  PostingDoc,
  RateDoc,
  TransactionDoc,
  TransactionOrigin,
} from '@have-fish/core/documents'
import { format } from '@have-fish/core/money'
import { readRate } from '@have-fish/core/rates'
import { MAX_COUNTER, MAX_WALL_MS, type Version } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import fc from 'fast-check'
import { rateId } from './rate-id'

/** Up to five of these sum to well under the largest amount a posting can carry. */
const MAX_LEG_CENTS = 10 ** 11

const deviceId = fc.stringMatching(/^[0-9a-f]{16}$/)

export const version: fc.Arbitrary<Version> = fc.record({
  wallMs: fc.integer({ min: 0, max: MAX_WALL_MS }),
  counter: fc.integer({ min: 0, max: MAX_COUNTER }),
  deviceId,
})

const date = fc
  .date({ min: new Date(Date.UTC(1900, 0, 1)), max: new Date(Date.UTC(2999, 11, 31)) })
  .filter((d) => !Number.isNaN(d.getTime()))
  .map((d) => d.toISOString().slice(0, 10))

// Whole graphemes, so any text a person can type, but never a lone surrogate.
const text = fc.string({ unit: 'grapheme', maxLength: 30 })

const made = { createdAt: fc.integer({ min: 0, max: MAX_WALL_MS }), deviceId }
const manual = fc.record({ source: fc.constant('manual'), ...made })
const system = fc.record({ source: fc.constant('system'), ...made })
const imported = fc.record({
  source: fc.constant('import'),
  ...made,
  file: text.filter((s) => s.length > 0),
  line: fc.integer({ min: 1, max: 1_000_000 }),
  text,
})

export const transactionOrigin: fc.Arbitrary<TransactionOrigin> = fc.oneof(manual, imported, system)
export const accountOrigin: fc.Arbitrary<AccountOrigin> = fc.oneof(manual, system)

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
  origin: transactionOrigin,
})

const tombstone: fc.Arbitrary<TransactionDoc> = fc.record({
  type: fc.constant('transaction'),
  id: fc.uuid(),
  date,
  description: text,
  postings: fc.constant([]),
  deletedAt,
  origin: transactionOrigin,
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
      currency: fc.option(fc.constantFrom(...CURRENCIES), { nil: null }),
      deletedAt: fc.option(deletedAt, { nil: null }),
      origin: accountOrigin,
    }),
  )

export const account: fc.Arbitrary<Versioned<AccountDoc>> = fc.record({
  doc: accountDoc,
  version,
})

const DAY_MS = 86_400_000

/** Plain decimal text, trailing zeros and all, that `readRate` takes: `'110.50'`, `'0.0091'`. */
const rateText = fc
  .tuple(fc.nat({ max: 999_999 }), fc.option(fc.stringMatching(/^\d{1,6}$/), { nil: null }))
  .map(([whole, places]) => (places === null ? `${whole}` : `${whole}.${places}`))
  .filter((r) => readRate(r).ok)

/** A typed rate, unpublished, or a fetched one published on its day or up to a week before. */
const rateDoc: fc.Arbitrary<RateDoc> = fc
  .record({
    date,
    pair: fc
      .tuple(fc.constantFrom(...CURRENCIES), fc.constantFrom(...CURRENCIES))
      .filter(([from, to]) => from !== to),
    rate: rateText,
    publishedBefore: fc.integer({ min: 0, max: 7 }),
    deletedAt: fc.option(deletedAt, { nil: null }),
    origin: accountOrigin,
  })
  .map(({ date, pair: [from, to], rate, publishedBefore, deletedAt, origin }): RateDoc => {
    const published =
      origin.source === 'manual'
        ? null
        : new Date(Date.parse(date) - publishedBefore * DAY_MS).toISOString().slice(0, 10)
    const r = { date, from, to, rate, published, deletedAt, origin }
    // Keys in the schema's order, so a document compares equal as JSON text too.
    return { type: 'rate', id: rateId(r), ...r }
  })

export const rate: fc.Arbitrary<Versioned<RateDoc>> = fc.record({ doc: rateDoc, version })
