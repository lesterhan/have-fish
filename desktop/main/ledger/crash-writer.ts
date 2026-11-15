// Test-only: writes batches of spends until it is killed, with a line in `saved` once each batch
// is committed. `crash.test.ts` bundles it, runs it on Electron's Node and kills it.

import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountDoc, AccountOrigin, TransactionDoc } from '@have-fish/core/documents'
import { openLedger } from '../db/ledger'
import { applyLocal } from './apply'

const [dir, installId, size] = process.argv.slice(2)
if (dir === undefined || installId === undefined || size === undefined) {
  throw new Error('usage: writer.mjs <ledger dir> <install id> <spends a batch>')
}

const opened = openLedger({ dir, installId, now: Date.now() })
if (!opened.ok) throw new Error(opened.failure.code)
const ledger = opened.value

const origin: AccountOrigin = {
  source: 'manual',
  createdAt: Date.now(),
  deviceId: ledger.meta.deviceId,
}
const account = (path: string, kind: AccountDoc['kind']): AccountDoc => ({
  type: 'account',
  id: randomUUID(),
  path,
  kind,
  currency: null,
  deletedAt: null,
  origin,
})
const cash = account('assets:cash', 'cash')
const food = account('expenses:food', 'category')
const accounts = applyLocal(ledger, [cash, food], Date.now())
if (!accounts.ok) throw new Error(accounts.failure.code)

for (let n = 1; ; n++) {
  const spends = Array.from(
    { length: Number(size) },
    (): TransactionDoc => ({
      type: 'transaction',
      id: randomUUID(),
      date: '2026-11-15',
      description: `batch ${n}`,
      postings: [
        { accountId: cash.id, amount: '-12.50', currency: 'CAD' },
        { accountId: food.id, amount: '12.50', currency: 'CAD' },
      ],
      deletedAt: null,
      origin,
    }),
  )
  const applied = applyLocal(ledger, spends, Date.now())
  if (!applied.ok) throw new Error(applied.failure.code)
  appendFileSync(join(dir, 'saved'), `${n}\n`)
}
