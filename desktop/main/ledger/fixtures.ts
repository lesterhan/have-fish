// Test-only: a throwaway ledger file, and builders that keep tests short. A test holds the
// builders to `readDocument`, as `arbitrary.ts`'s generators are held to `readVersioned`.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountDoc, RateDoc, TransactionDoc } from '@have-fish/core/documents'
import type { Outcome } from '@have-fish/core/outcome'
import Database from 'better-sqlite3'
import { onTestFinished } from 'vitest'
import { type Ledger, openLedger } from '../db/ledger'
import { applyLocal } from './apply'
import { rateId } from './rate-id'

export const NOW = Date.UTC(2026, 9, 29, 12)

/** Not any temp ledger's device: an origin names its maker, which needn't be this file. */
export const MAKER = 'feedfacecafebeef'

/** Entered by hand at `NOW`. */
export const MANUAL = { source: 'manual', createdAt: NOW, deviceId: MAKER } as const

/** Fetched at `NOW`, as a rate service's is. */
export const SYSTEM = { source: 'system', createdAt: NOW, deviceId: MAKER } as const

/** A new ledger in its own temp folder. `dispose` closes it and deletes the folder. */
export function openTempLedger(installId = 'install-a'): { ledger: Ledger; dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'havefish-apply-'))
  const ledger = ok(openLedger({ dir, installId, now: NOW }))
  return {
    ledger,
    dispose() {
      ledger.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** A new ledger, disposed of when the test finishes. Call it inside the test. */
export function tempLedger(): Ledger {
  const { ledger, dispose } = openTempLedger()
  onTestFinished(dispose)
  return ledger
}

/** Unwraps an ok outcome, or fails the test with the refusal. */
export function ok<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`refused: ${JSON.stringify(outcome.failure)}`)
  return outcome.value
}

/** A live cash account with a new id. */
export function anAccount(fields: Partial<AccountDoc> = {}): AccountDoc {
  return {
    type: 'account',
    id: randomUUID(),
    path: 'assets:cash',
    kind: 'cash',
    currency: null,
    deletedAt: null,
    origin: MANUAL,
    ...fields,
  }
}

/** A live spend of `amount` in `currency`, from one account to another, with a new id. */
function aSpendIn(
  currency: string,
  fromId: string,
  toId: string,
  amount: string,
  fields: Partial<TransactionDoc> = {},
): TransactionDoc {
  return {
    type: 'transaction',
    id: randomUUID(),
    date: '2026-10-29',
    description: 'Groceries',
    postings: [
      { accountId: fromId, amount: `-${amount}`, currency },
      { accountId: toId, amount, currency },
    ],
    deletedAt: null,
    origin: MANUAL,
    ...fields,
  }
}

/** A live spend of `amount` CAD, from one account to another, with a new id. */
export function aSpend(
  fromId: string,
  toId: string,
  amount = '12.50',
  fields: Partial<TransactionDoc> = {},
): TransactionDoc {
  return aSpendIn('CAD', fromId, toId, amount, fields)
}

/** An exchange of `from` into `to`, the four postings it pays and takes through `via`. */
function anExchange(
  from: { accountId: string; currency: string; amount: string },
  to: { accountId: string; currency: string; amount: string },
  via: string,
  fields: { date: string; at: number },
): TransactionDoc {
  return {
    type: 'transaction',
    id: randomUUID(),
    date: fields.date,
    description: 'Exchange',
    postings: [
      { accountId: from.accountId, amount: `-${from.amount}`, currency: from.currency },
      { accountId: via, amount: from.amount, currency: from.currency },
      { accountId: via, amount: `-${to.amount}`, currency: to.currency },
      { accountId: to.accountId, amount: to.amount, currency: to.currency },
    ],
    deletedAt: null,
    origin: { ...MANUAL, createdAt: NOW - fields.at },
  }
}

/** A typed CAD to JPY rate for 2026-11-05, its id derived from its fields unless given. */
export function aRate(fields: Partial<RateDoc> = {}): RateDoc {
  const { id, ...rest } = fields
  const r = {
    type: 'rate',
    date: '2026-11-05',
    from: 'CAD',
    to: 'JPY',
    rate: '110.5',
    published: null,
    deletedAt: null,
    origin: MANUAL,
    ...rest,
  } as const
  return { ...r, id: id ?? rateId(r) }
}

/** The same transaction, deleted at `at`. */
export function tombstoneOf(doc: TransactionDoc, at = NOW): TransactionDoc {
  return { ...doc, postings: [], deletedAt: at }
}

const DAY = 86_400_000

/** Which ten-year ledger `aLedgerOf` writes: CAD alone, or the worst case for rates. */
export type LedgerProfile = 'home' | 'traveller'

/** The five currencies the traveller's trips are in, one trip every sixty days in turn. */
const TRIPS = ['EUR', 'CNY', 'JPY', 'GBP', 'MXN'] as const

type Trip = (typeof TRIPS)[number]

/** What a trip costs in its own currency, for 200 CAD and for 150 USD. */
const FROM_CAD: Record<Trip, string> = {
  EUR: '135.00',
  CNY: '1040.00',
  JPY: '21800.00',
  GBP: '115.00',
  MXN: '2600.00',
}

const FROM_USD: Record<Trip, string> = {
  EUR: '140.00',
  CNY: '1080.00',
  JPY: '22500.00',
  GBP: '118.00',
  MXN: '2700.00',
}

/** What a rate into CAD is, fetched each day: the trip currencies among them. */
const FETCHED = [
  ['USD', '1.38'],
  ['EUR', '1.48'],
  ['CNY', '0.19'],
  ['JPY', '0.0092'],
  ['GBP', '1.74'],
  ['MXN', '0.077'],
] as const

/** A traveller's own accounts: USD in and out, the conversion account, a wallet per trip. */
function aTraveller() {
  const wallet = (currency: Trip) =>
    anAccount({ path: `assets:cash:${currency.toLowerCase()}`, kind: 'cash', currency })
  return {
    us: anAccount({ path: 'assets:us', kind: 'bank', currency: 'USD' }),
    usPay: anAccount({ path: 'income:us', kind: 'income' }),
    via: anAccount({ path: 'equity:conversion', kind: 'conversion' }),
    wallets: {
      EUR: wallet('EUR'),
      CNY: wallet('CNY'),
      JPY: wallet('JPY'),
      GBP: wallet('GBP'),
      MXN: wallet('MXN'),
    },
  }
}

/**
 * About ten years of ledger at 50,000: `n` spends, fourteen a day ending at `NOW`, from a card and
 * a chequing account into six categories, a pay day every two weeks, and each account's starting
 * balance. Written as one batch, into `ledger`. The traveller's is the worst case for rates: a
 * trip every sixty days in one of five currencies, exchanges from CAD and from USD, and a rate
 * fetched every day.
 */
export function aLedgerOf(
  n: number,
  ledger = tempLedger(),
  profile: LedgerProfile = 'home',
): Ledger {
  const card = anAccount({ path: 'liabilities:visa', kind: 'card' })
  const bank = anAccount({ path: 'assets:chequing', kind: 'bank' })
  const opening = anAccount({ path: 'equity:opening', kind: 'opening' })
  const pay = anAccount({ path: 'income:salary', kind: 'income' })
  const categories = ['food', 'rent', 'travel', 'books', 'transit', 'gifts'].map((name) =>
    anAccount({ path: `expenses:${name}`, kind: 'category' }),
  )
  const traveller = profile === 'traveller' ? aTraveller() : null
  const day = (i: number) => new Date(NOW - Math.floor(i / 14) * DAY).toISOString().slice(0, 10)
  const oldest = day(n)
  const docs: (AccountDoc | TransactionDoc | RateDoc)[] = [card, bank, opening, pay, ...categories]
  if (traveller !== null) {
    docs.push(traveller.us, traveller.usPay, traveller.via, ...Object.values(traveller.wallets))
  }
  // What I owe starts negative: the card's leg is the paying one.
  for (const [from, to] of [
    [opening, bank],
    [card, opening],
  ] as const) {
    docs.push(
      aSpend(from.id, to.id, '300.00', {
        date: oldest,
        description: 'Starting balance',
        origin: { ...MANUAL, createdAt: NOW - n - 1 },
      }),
    )
  }
  for (let i = 0; i < n; i++) {
    const date = day(i)
    const spend = { date, description: `Spend ${i}`, origin: { ...MANUAL, createdAt: NOW - i } }
    const category = categories[i % categories.length] as AccountDoc
    if (traveller === null) {
      const paid = i % 28 === 0
      docs.push(
        aSpend(
          paid ? pay.id : (i % 3 === 0 ? bank : card).id,
          paid ? bank.id : category.id,
          paid ? '1500.00' : '12.50',
          spend,
        ),
      )
      continue
    }
    // Every day's rate into CAD, fetched that day.
    if (i % 14 === 0) {
      for (const [from, rate] of FETCHED) {
        docs.push(aRate({ from, to: 'CAD', rate, date, published: date, origin: SYSTEM }))
      }
    }

    // A trip is the first fourteen days of every sixty, in one currency after another.
    const d = Math.floor(i / 14)
    const trip = d % 60 < 14 ? TRIPS[Math.floor(d / 60) % TRIPS.length] : undefined
    // One transaction a day, as home writes one: a pay day takes its spend's place.
    if (i % 28 === 0) {
      docs.push(aSpendIn('CAD', pay.id, bank.id, '1500.00', spend))
    } else if (i % 28 === 14) {
      docs.push(aSpendIn('USD', traveller.usPay.id, traveller.us.id, '1500.00', spend))
    } else if (trip !== undefined) {
      const wallet = traveller.wallets[trip]
      if (i % 14 === 1) {
        docs.push(
          anExchange(
            { accountId: bank.id, currency: 'CAD', amount: '200.00' },
            { accountId: wallet.id, currency: trip, amount: FROM_CAD[trip] },
            traveller.via.id,
            { date, at: i },
          ),
        )
      } else if (i % 14 === 2) {
        docs.push(
          anExchange(
            { accountId: traveller.us.id, currency: 'USD', amount: '150.00' },
            { accountId: wallet.id, currency: trip, amount: FROM_USD[trip] },
            traveller.via.id,
            { date, at: i },
          ),
        )
      } else {
        docs.push(aSpendIn(trip, wallet.id, category.id, '12.50', spend))
      }
    } else {
      docs.push(
        i % 3 === 0
          ? aSpendIn('USD', traveller.us.id, category.id, '12.50', spend)
          : aSpendIn('CAD', card.id, category.id, '12.50', spend),
      )
    }
  }
  ok(applyLocal(ledger, docs, NOW))
  return ledger
}

type Ran = { sql: string; args: unknown[]; ms: number }

/** Each statement run while `during` does, with its arguments and how long it took. */
export function recorded(during: () => void): Ran[] {
  const ran: Ran[] = []
  const probe = new Database(':memory:')
  const proto = Object.getPrototypeOf(probe.prepare('SELECT 1')) as Record<string, unknown>
  probe.close()
  const kept = new Map<string, unknown>()
  for (const method of ['all', 'get', 'run', 'iterate']) {
    const original = proto[method] as (this: Database.Statement, ...args: unknown[]) => unknown
    kept.set(method, original)
    proto[method] = function (this: Database.Statement, ...args: unknown[]) {
      const started = performance.now()
      const result = original.apply(this, args)
      ran.push({ sql: this.source, args, ms: performance.now() - started })
      return result
    }
  }
  try {
    during()
  } finally {
    for (const [method, original] of kept) proto[method] = original
  }
  return ran
}
