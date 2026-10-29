// If two devices end up with the same documents whatever order they hear of each other's edits,
// sync can be built on apply. A failure here prints a seed and a path; pass both to `fc.assert`
// to replay just that case.

import { rootOf } from '@have-fish/core/account-kind'
import type { AccountDoc, LedgerDocument, TransactionDoc } from '@have-fish/core/documents'
import { format } from '@have-fish/core/money'
import { compareVersions } from '@have-fish/core/version'
import type { Versioned } from '@have-fish/core/versioned'
import fc from 'fast-check'
import { expect, test } from 'vitest'
import type { Ledger } from '../db/ledger'
import { applyLocal, applyReceived } from './apply'
import { NOW, ok, openTempLedger } from './fixtures'
import { getDocument } from './store'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

// Both devices start with these accounts, and edit the same three transactions.
const ACCOUNTS: AccountDoc[] = [
  { type: 'account', id: uuid(0xa1), path: 'assets:cash', kind: 'cash', deletedAt: null },
  { type: 'account', id: uuid(0xa2), path: 'expenses:food', kind: 'category', deletedAt: null },
  { type: 'account', id: uuid(0xa3), path: 'expenses:fun', kind: 'category', deletedAt: null },
]
const SLOTS = [uuid(1), uuid(2), uuid(3)]

type Device = 0 | 1
type Action =
  | { kind: 'spend'; device: Device; slot: number; to: number; cents: number; advance: number }
  | { kind: 'delete'; device: Device; slot: number; advance: number }
  | { kind: 'rename'; device: Device; account: number; name: string; advance: number }
  | { kind: 'deliver'; device: Device; count: number; advance: number }

const device = fc.constantFrom<Device>(0, 1)
const slot = fc.nat({ max: SLOTS.length - 1 })
// Mostly forward, sometimes not at all; each device's own skew makes their clocks disagree.
const advance = fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 3_000 }))

const action: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('spend'),
      device,
      slot,
      to: fc.constantFrom(1, 2),
      cents: fc.integer({ min: 1, max: 100_000 }),
      advance,
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('delete'), device, slot, advance }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('rename'),
      device,
      account: fc.nat({ max: ACCOUNTS.length - 1 }),
      name: fc.constantFrom('a', 'b', 'c'),
      advance,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('deliver'),
      device,
      count: fc.integer({ min: 1, max: 4 }),
      advance,
    }),
  },
)

// Within two minutes either way: well inside the drift, so nothing is refused. Often none, so
// both devices stamp the same times and the device id breaks the tie.
const skew = fc.oneof(fc.constant(0), fc.integer({ min: -120_000, max: 120_000 }))

function docFor(a: Action): LedgerDocument | null {
  switch (a.kind) {
    case 'spend': {
      const amount = format(a.cents)
      const doc: TransactionDoc = {
        type: 'transaction',
        id: SLOTS[a.slot] ?? '',
        date: '2026-10-29',
        description: `spend ${amount}`,
        postings: [
          { accountId: ACCOUNTS[0]?.id ?? '', amount: format(-a.cents), currency: 'CAD' },
          { accountId: ACCOUNTS[a.to]?.id ?? '', amount, currency: 'CAD' },
        ],
        deletedAt: null,
      }
      return doc
    }
    case 'delete':
      return {
        type: 'transaction',
        id: SLOTS[a.slot] ?? '',
        date: '2026-10-29',
        description: 'deleted',
        postings: [],
        deletedAt: NOW,
      }
    case 'rename': {
      const account = ACCOUNTS[a.account] as AccountDoc
      return { ...account, path: `${rootOf(account.kind)}:${a.name}` }
    }
    case 'deliver':
      return null
  }
}

test('two ledgers that hear of each other’s edits in any order end up the same', () => {
  fc.assert(
    fc.property(
      fc.array(action, { maxLength: 25 }),
      fc.tuple(skew, skew),
      fc.gen(),
      (actions, skews, gen) => {
        const opened = [openTempLedger('install-a'), openTempLedger('install-b')]
        try {
          const ledgers = opened.map((o) => o.ledger) as [Ledger, Ledger]
          // What each device has written, in order, and how much of the other's it has heard.
          const sent: [Versioned[], Versioned[]] = [[], []]
          const heard = [0, 0]
          let time = NOW
          const nowOf = (d: Device) => time + skews[d]

          const write = (d: Device, doc: LedgerDocument) => {
            const { written } = ok(applyLocal(ledgers[d], [doc], nowOf(d)))
            for (const w of written) {
              const stored = getDocument(ledgers[d].db, w.type, w.id)
              if (stored) sent[d].push(stored)
            }
          }
          const receive = (d: Device, items: Versioned[]) => {
            expect(applyReceived(ledgers[d], items, nowOf(d)).refused).toEqual([])
          }

          // Device 0 makes the accounts; device 1 hears of them first thing.
          for (const account of ACCOUNTS) write(0, account)
          receive(1, sent[0])
          heard[1] = sent[0].length

          for (const a of actions) {
            time += a.advance
            if (a.kind === 'deliver') {
              const other = sent[1 - a.device] as Versioned[]
              const next = other.slice(heard[a.device], (heard[a.device] ?? 0) + a.count)
              receive(a.device, next)
              heard[a.device] = (heard[a.device] ?? 0) + next.length
            } else {
              write(a.device, docFor(a) as LedgerDocument)
            }
          }

          // Everything the other device sent, shuffled, with some of it twice.
          time += 1_000
          for (const d of [0, 1] as const) {
            const other = sent[1 - d] as Versioned[]
            const again = gen(fc.subarray, other)
            receive(
              d,
              gen(fc.shuffledSubarray, [...other, ...again], {
                minLength: other.length + again.length,
              }),
            )
          }

          const everything = [...sent[0], ...sent[1]]
          for (const id of [...ACCOUNTS.map((a) => a.id), ...SLOTS]) {
            const type = SLOTS.includes(id) ? 'transaction' : 'account'
            const [here, there] = ledgers.map((l) => getDocument(l.db, type, id))
            expect(JSON.stringify(here)).toBe(JSON.stringify(there))
            // And the one both kept is the newest that either wrote.
            const newest = everything
              .filter((v) => v.doc.id === id)
              .toSorted((a, b) => compareVersions(b.version, a.version))[0]
            expect(here ?? null).toEqual(newest ?? null)
          }
        } finally {
          for (const o of opened) o.dispose()
        }
      },
    ),
    // Each run opens two files, so this is slow. At 50s fast-check stops, inside the test's
    // timeout: mid-shrink it prints what it has; short of 200 runs it fails, never passes.
    { numRuns: 200, plugins: [fc.interruptAfterTimeLimit(50_000, { failOnInterrupt: true })] },
  )
}, 60_000)
