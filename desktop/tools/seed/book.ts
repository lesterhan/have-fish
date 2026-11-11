// A ledger built in memory before any of it is written: the accounts, each transaction with what
// the guide says about it, and running balances for the generator to spend against.

import type { AccountKind } from '@have-fish/core/account-kind'
import type { AccountDoc, TransactionDoc, TransactionOrigin } from '@have-fish/core/documents'
import { cents as centsOf, format } from '@have-fish/core/money'
import { CONVERSION, OPENING } from '@have-fish/core/own-accounts'
import { type Rng, rngFrom, uuidFrom } from './random'

/** What a transaction is there to show. `guide.ts` says what each one looks like in the app. */
export type Shape =
  | 'opening'
  | 'spend'
  | 'split'
  | 'pay-split'
  | 'interest'
  | 'transfer'
  | 'card-payoff'
  | 'loan-payment'
  | 'refund'
  | 'wise-conversion'
  | 'wise-foreign'
  | 'wise-mixed'
  | 'card-foreign'
  | 'card-foreign-fee'
  | 'card-fee-later'
  | 'alipay-fee'
  | 'atm-abroad'
  | 'cash-foreign'
  | 'remittance'
  | 'reimbursement'
  | 'edge'

/** One posting: an account's path, signed cents and a currency. */
export type Leg = readonly [path: string, cents: number, currency: string]

export type Meta = {
  shape?: Shape
  /** Life events, for the tags still to come: `#taiwan2026`. */
  tags?: readonly string[]
  /** A recurring charge's name, the same on every charge of it: `Netflix`. */
  series?: string
  /** What the guide says about this one in particular. */
  note?: string
  origin?: TransactionOrigin
}

export type Change = 'amount' | 'description' | 'deleted'

export type Entry = {
  /** As first written. */
  doc: TransactionDoc
  /** As it stands once any edit or deletion is applied: `doc` itself when there's none. */
  final: TransactionDoc
  change: { what: Change; at: number; was: string } | null
  shape: Shape
  tags: string[]
  series: string | null
  note: string | null
}

export type BookOptions = {
  seed: string
  /** The device the documents say made them. */
  deviceId: string
  /** The real time now, UTC ms: nothing is made after it. */
  nowMs: number
  /** The last day anything is dated. */
  today: string
}

const HOUR_MS = 3_600_000

export const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`)

/** Accounts kept to their own money: the generator throws rather than take one below zero. */
const NEVER_OVERDRAWN = /^assets:(wise:|cash$)/

export class Book {
  readonly accounts = new Map<string, AccountDoc>()
  readonly entries: Entry[] = []
  private readonly running = new Map<string, Map<string, number>>()
  private readonly perDay = new Map<string, number>()

  constructor(readonly options: BookOptions) {}

  /** The randomness for one purpose on one day. */
  rng(date: string, stream: string): Rng {
    return rngFrom(`${this.options.seed}:${stream}:${date}`)
  }

  /** Adds an account I opened (or the app made, when `system`), made on `date`. */
  open(path: string, kind: AccountKind, currency: string | null, date: string, system = false) {
    const existing = this.accounts.get(path)
    if (existing) return existing
    const doc: AccountDoc = {
      type: 'account',
      id: uuidFrom(`${this.options.seed}:account:${path}`),
      path,
      kind,
      currency,
      deletedAt: null,
      origin: {
        source: system ? 'system' : 'manual',
        createdAt: Math.min(dayMs(date) + 13 * HOUR_MS, this.options.nowMs),
        deviceId: this.options.deviceId,
      },
    }
    this.accounts.set(path, doc)
    return doc
  }

  /** Whether `date` has come yet. */
  reached(date: string): boolean {
    return date <= this.options.today
  }

  /** What `path` holds in `currency` so far, in cents. */
  balance(path: string, currency: string): number {
    return this.running.get(path)?.get(currency) ?? 0
  }

  /** A transaction on `date`. Categories and income sources it names are made as it needs them. */
  add(date: string, description: string, legs: readonly Leg[], meta: Meta = {}): Entry {
    if (date > this.options.today) throw new Error(`${description} is dated after today: ${date}`)
    const n = this.perDay.get(date) ?? 0
    this.perDay.set(date, n + 1)
    const postings = legs.map(([path, cents, currency]) => {
      const account = this.accountFor(path, date)
      if (account.currency !== null && account.currency !== currency) {
        throw new Error(`${path} is kept to ${account.currency}, not ${currency}`)
      }
      return { accountId: account.id, amount: format(cents), currency }
    })
    const doc: TransactionDoc = {
      type: 'transaction',
      id: uuidFrom(`${this.options.seed}:transaction:${date}:${n}`),
      date,
      description,
      postings,
      deletedAt: null,
      origin: meta.origin ?? {
        source: 'manual',
        // Through the day from mid-morning in Toronto, in the order they were written.
        createdAt: Math.min(dayMs(date) + 14 * HOUR_MS + n * 23 * 60_000, this.options.nowMs),
        deviceId: this.options.deviceId,
      },
    }
    for (const [path, cents, currency] of legs) this.move(path, cents, currency, description)
    const entry: Entry = {
      doc,
      final: doc,
      change: null,
      shape: meta.shape ?? 'spend',
      tags: [...(meta.tags ?? [])],
      series: meta.series ?? null,
      note: meta.note ?? null,
    }
    this.entries.push(entry)
    return entry
  }

  /**
   * Makes `wrong` the entry's first version, and the entry as it is its fix, saved at `at`: a
   * typo corrected the next day. Balances follow the fix, which is what the ledger ends with.
   */
  mistype(entry: Entry, what: 'amount' | 'description', wrong: TransactionDoc, at: number) {
    const was = what === 'amount' ? (wrong.postings[0]?.amount ?? '') : wrong.description
    entry.doc = wrong
    entry.change = { what, at, was }
  }

  /** A copy of `entry` saved by mistake and deleted at `at`. It moves no balance. */
  deletedCopy(entry: Entry, at: number): Entry {
    const doc: TransactionDoc = {
      ...entry.doc,
      id: uuidFrom(`${this.options.seed}:copy:${entry.doc.id}`),
      origin: { ...entry.doc.origin, createdAt: entry.doc.origin.createdAt + 60_000 },
    }
    const copy: Entry = {
      doc,
      final: { ...doc, postings: [], deletedAt: at },
      change: { what: 'deleted', at, was: doc.description },
      shape: entry.shape,
      tags: [...entry.tags],
      series: null,
      note: 'Saved twice by mistake; the copy was deleted.',
    }
    this.entries.push(copy)
    return copy
  }

  /** Each account's balances as the ledger will hold them: from every entry's final version. */
  finalBalances(): Map<string, Map<string, number>> {
    const byId = new Map([...this.accounts.values()].map((a) => [a.id, a.path]))
    const out = new Map<string, Map<string, number>>()
    for (const { final } of this.entries) {
      for (const p of final.postings) {
        const path = byId.get(p.accountId) ?? p.accountId
        const held = out.get(path) ?? new Map<string, number>()
        held.set(p.currency, (held.get(p.currency) ?? 0) + centsOf(p.amount))
        out.set(path, held)
      }
    }
    return out
  }

  private accountFor(path: string, date: string): AccountDoc {
    const known = this.accounts.get(path)
    if (known) return known
    const kind = madeKind(path)
    if (kind === null) throw new Error(`open ${path} before posting to it`)
    return this.open(path, kind, null, date, kind === 'opening' || kind === 'conversion')
  }

  private move(path: string, cents: number, currency: string, description: string) {
    const held = this.running.get(path) ?? new Map<string, number>()
    const after = (held.get(currency) ?? 0) + cents
    if (after < 0 && NEVER_OVERDRAWN.test(path)) {
      throw new Error(`${description} takes ${path} below zero in ${currency}`)
    }
    held.set(currency, after)
    this.running.set(path, held)
  }
}

/** The kind of an account the app makes when a spend names it, from its root. */
function madeKind(path: string): AccountKind | null {
  if (path.startsWith('expenses:')) return 'category'
  if (path.startsWith('income:')) return 'income'
  if (path === OPENING.path) return OPENING.kind
  if (path === CONVERSION.path) return CONVERSION.kind
  return null
}
