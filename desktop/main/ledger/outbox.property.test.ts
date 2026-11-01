// Whatever mix of local writes, pushes and acknowledgements happens, the outbox holds exactly
// the documents written here since sync last had them, each at the version the file holds. A
// failure prints a seed and a path; pass both to `fc.assert` to replay just that case.

import { rootOf } from '@have-fish/core/account-kind'
import type { AccountDoc, LedgerDocument } from '@have-fish/core/documents'
import { format } from '@have-fish/core/money'
import { formatVersion } from '@have-fish/core/version'
import { readVersioned } from '@have-fish/core/versioned'
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { applyLocal } from './apply'
import { anAccount, aSpend, MANUAL, NOW, ok, openTempLedger, tombstoneOf } from './fixtures'
import { acknowledge, queued } from './outbox'
import { getDocument } from './store'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const ACCOUNTS: AccountDoc[] = [
  anAccount({ id: uuid(0xa1) }),
  anAccount({ id: uuid(0xa2), path: 'expenses:food', kind: 'category' }),
  anAccount({ id: uuid(0xa3), path: 'expenses:fun', kind: 'category' }),
]
const SLOTS = [uuid(1), uuid(2), uuid(3)]

type Edit =
  | { kind: 'spend'; slot: number; to: number; cents: number }
  | { kind: 'delete'; slot: number }
  | { kind: 'rename'; account: number; name: string }
type Step =
  | { kind: 'write'; edits: Edit[] }
  /** Sync reads up to `limit` rows and starts pushing them. */
  | { kind: 'push'; limit: number }
  /** The relay acknowledges the oldest push still in flight. */
  | { kind: 'ack' }

const slot = fc.nat({ max: SLOTS.length - 1 })
const edit: fc.Arbitrary<Edit> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('spend'),
      slot,
      to: fc.constantFrom(1, 2),
      cents: fc.integer({ min: 1, max: 100_000 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete'), slot }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('rename'),
      account: fc.nat({ max: ACCOUNTS.length - 1 }),
      name: fc.constantFrom('a', 'b', 'c'),
    }),
  },
)
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('write'),
      edits: fc.array(edit, { minLength: 1, maxLength: 3 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('push'), limit: fc.integer({ min: 1, max: 8 }) }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('ack') }) },
)

function docFor(e: Edit): LedgerDocument {
  switch (e.kind) {
    case 'spend': {
      const [cash, to] = [ACCOUNTS[0]?.id ?? '', ACCOUNTS[e.to]?.id ?? '']
      return aSpend(cash, to, format(e.cents), { id: SLOTS[e.slot] ?? '', origin: MANUAL })
    }
    case 'delete':
      return tombstoneOf(
        aSpend(ACCOUNTS[0]?.id ?? '', ACCOUNTS[1]?.id ?? '', '1.00', {
          id: SLOTS[e.slot] ?? '',
        }),
      )
    case 'rename': {
      const account = ACCOUNTS[e.account] as AccountDoc
      return { ...account, path: `${rootOf(account.kind)}:${e.name}` }
    }
  }
}

const keyOf = (type: string, id: string) => `${type}:${id}`

test('the outbox holds what sync hasn’t had, each at the version the file holds', () => {
  fc.assert(
    fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
      const { ledger, dispose } = openTempLedger()
      try {
        // The model: how many times each document was written here, and how many of those
        // writes the relay has acknowledged. A push remembers the count it saw for each row.
        const writes = new Map<string, number>()
        const acked = new Map<string, number>()
        const inFlight: { rowId: string; key: string; writes: number }[][] = []

        const write = (docs: LedgerDocument[]) => {
          ok(applyLocal(ledger, docs, NOW))
          for (const d of docs) {
            const key = keyOf(d.type, d.id)
            writes.set(key, (writes.get(key) ?? 0) + 1)
          }
        }

        write(ACCOUNTS)
        for (const s of steps) {
          if (s.kind === 'write') write(s.edits.map(docFor))
          else if (s.kind === 'push') {
            inFlight.push(
              queued(ledger.db, s.limit).map((r) => {
                const key = keyOf(r.docType, r.docId)
                return { rowId: r.rowId, key, writes: writes.get(key) ?? 0 }
              }),
            )
          } else {
            const push = inFlight.shift()
            if (push === undefined) continue
            acknowledge(
              ledger.db,
              push.map((r) => r.rowId),
            )
            // Only a document not written again since the push has been had.
            for (const r of push) if (writes.get(r.key) === r.writes) acked.set(r.key, r.writes)
          }

          const rows = queued(ledger.db, 1_000)
          for (const row of rows) {
            const stored = getDocument(ledger.db, row.docType, row.docId)
            expect(readVersioned(JSON.parse(row.body))).toEqual({ ok: true, value: stored })
            expect(row.version).toBe(stored && formatVersion(stored.version))
          }
          const waiting = [...writes].filter(([key, n]) => n > (acked.get(key) ?? 0))
          expect(rows.map((r) => keyOf(r.docType, r.docId)).sort()).toEqual(
            waiting.map(([key]) => key).sort(),
          )
        }
      } finally {
        dispose()
      }
    }),
    { numRuns: 200, plugins: [fc.interruptAfterTimeLimit(50_000, { failOnInterrupt: true })] },
  )
}, 60_000)
