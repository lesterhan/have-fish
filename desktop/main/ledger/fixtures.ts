// Test-only: a throwaway ledger file, and builders that keep tests short. A test holds the
// builders to `readDocument`, as `arbitrary.ts`'s generators are held to `readVersioned`.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import type { Outcome } from '@have-fish/core/outcome'
import { onTestFinished } from 'vitest'
import { type Ledger, openLedger } from '../db/ledger'
import { applyLocal } from './apply'

export const NOW = Date.UTC(2026, 9, 29, 12)

/** Not any temp ledger's device: an origin names its maker, which needn't be this file. */
export const MAKER = 'feedfacecafebeef'

/** Entered by hand at `NOW`. */
export const MANUAL = { source: 'manual', createdAt: NOW, deviceId: MAKER } as const

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

/** A live spend of `amount` CAD, from one account to another, with a new id. */
export function aSpend(
  fromId: string,
  toId: string,
  amount = '12.50',
  fields: Partial<TransactionDoc> = {},
): TransactionDoc {
  return {
    type: 'transaction',
    id: randomUUID(),
    date: '2026-10-29',
    description: 'Groceries',
    postings: [
      { accountId: fromId, amount: `-${amount}`, currency: 'CAD' },
      { accountId: toId, amount, currency: 'CAD' },
    ],
    deletedAt: null,
    origin: MANUAL,
    ...fields,
  }
}

/** The same transaction, deleted at `at`. */
export function tombstoneOf(doc: TransactionDoc, at = NOW): TransactionDoc {
  return { ...doc, postings: [], deletedAt: at }
}

const DAY = 86_400_000

/**
 * About ten years of ledger at 50,000: `n` spends, fourteen a day ending at `NOW`, from a card and
 * a chequing account into six categories, a pay day every two weeks, and each account's starting
 * balance. Written as one batch, into `ledger`.
 */
export function aLedgerOf(n: number, ledger = tempLedger()): Ledger {
  const card = anAccount({ path: 'liabilities:visa', kind: 'card' })
  const bank = anAccount({ path: 'assets:chequing', kind: 'bank' })
  const opening = anAccount({ path: 'equity:opening', kind: 'opening' })
  const pay = anAccount({ path: 'income:salary', kind: 'income' })
  const categories = ['food', 'rent', 'travel', 'books', 'transit', 'gifts'].map((name) =>
    anAccount({ path: `expenses:${name}`, kind: 'category' }),
  )
  const day = (i: number) => new Date(NOW - Math.floor(i / 14) * DAY).toISOString().slice(0, 10)
  const oldest = day(n)
  const docs: (AccountDoc | TransactionDoc)[] = [card, bank, opening, pay, ...categories]
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
    const paid = i % 28 === 0
    docs.push(
      aSpend(
        paid ? pay.id : (i % 3 === 0 ? bank : card).id,
        paid ? bank.id : (categories[i % categories.length] as AccountDoc).id,
        paid ? '1500.00' : '12.50',
        { date: day(i), description: `Spend ${i}`, origin: { ...MANUAL, createdAt: NOW - i } },
      ),
    )
  }
  ok(applyLocal(ledger, docs, NOW))
  return ledger
}
