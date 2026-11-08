import { describe, expect, test } from 'vitest'
import { contextFor } from '../context'
import type { Ledger } from '../db/ledger'
import { aLedgerOf, ok, tempLedger } from '../ledger/fixtures'
import { addAccount } from './accounts'
import { listPaths } from './paths'
import { removeSpend, writeSpend } from './spends'

const LATE = Date.UTC(2026, 9, 29, 12)

function setup() {
  const ledger = tempLedger()
  const clock = { at: LATE, now: () => clock.at, timeZone: () => 'UTC' }
  const ctx = contextFor(ledger, () => {}, clock)
  return { ledger, ctx, clock }
}

const at = (paths: ReturnType<typeof listPaths>, path: string) => paths.find((p) => p.path === path)

describe('every path', () => {
  test('its whole path, kind, and when it was last used', () => {
    const { ledger, ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee', to: { category: 'food' } }))
    const paths = listPaths(ledger.db)
    expect(at(paths, 'assets:cash')).toMatchObject({ kind: 'cash', lastUsed: LATE })
    expect(at(paths, 'expenses:food')).toMatchObject({ kind: 'category', lastUsed: LATE })
  })

  test('the latest live transaction that used it wins', () => {
    const { ledger, ctx, clock } = setup()
    const first = ok(
      writeSpend(ctx, { amount: '4.50', description: 'Coffee', to: { category: 'food' } }),
    )
    clock.at += 60_000
    const second = ok(
      writeSpend(ctx, { amount: '6', description: 'Lunch', to: { category: 'food' } }),
    )
    expect(at(listPaths(ledger.db), 'expenses:food')?.lastUsed).toBe(LATE + 60_000)

    ok(removeSpend(ctx, { id: second.id }))
    expect(at(listPaths(ledger.db), 'expenses:food')?.lastUsed).toBe(LATE)
    expect(first.id).not.toBe(second.id)
  })

  test('an account nothing has used has no last use', () => {
    const { ledger, ctx } = setup()
    ok(addAccount(ctx, { name: 'savings', kind: 'bank', currency: 'CAD' }))
    expect(at(listPaths(ledger.db), 'assets:savings')?.lastUsed).toBeNull()
  })
})

describe('at ten years', { timeout: 120_000 }, () => {
  test('every path comes from an index read, in one pass, quickly', () => {
    const ledger: Ledger = aLedgerOf(50_000)
    const started = performance.now()
    const paths = listPaths(ledger.db)
    const took = performance.now() - started

    expect(paths.length).toBeGreaterThan(5)
    expect(paths.every((p) => p.lastUsed !== null)).toBe(true)
    // About 70 ms; loose for a slow runner, and paid once per change, not once per focus.
    expect(took).toBeLessThan(150)

    const plan = ledger.db
      .prepare<[], { detail: string }>(
        `EXPLAIN QUERY PLAN
        SELECT a.id, a.path, a.kind, max(t.originCreatedAt) AS lastUsed
          FROM accounts AS a
          LEFT JOIN postings AS p ON p.accountId = a.id
          LEFT JOIN transactions AS t ON t.id = p.transactionId AND t.deletedAt IS NULL
          WHERE a.deletedAt IS NULL
          GROUP BY a.id
          ORDER BY a.path`,
      )
      .all()
      .map((row) => row.detail)
    expect(plan).toEqual([
      // A few dozen accounts, each by its primary key, out to its postings and their transactions.
      // The sort is of those accounts' paths.
      'SCAN a USING INDEX sqlite_autoindex_accounts_1',
      'SEARCH p USING COVERING INDEX postings_account_transaction (accountId=?) LEFT-JOIN',
      'SEARCH t USING INDEX sqlite_autoindex_transactions_1 (id=?) LEFT-JOIN',
      'USE TEMP B-TREE FOR ORDER BY',
    ])
  })
})
