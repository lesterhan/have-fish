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
