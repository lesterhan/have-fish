import { describe, expect, test } from 'vitest'
import { contextFor } from '../../context'
import type { Ledger } from '../../db/ledger'
import { aLedgerOf, ok, recorded, tempLedger } from '../../ledger/fixtures'
import { addAccount } from '../accounts/accounts'
import { removeSpend, writeSpend } from '../spends/spends'
import { listPaths } from './paths'

const LATE = Date.UTC(2026, 9, 29, 12)

function setup() {
  const ledger = tempLedger()
  const clock = { at: LATE, now: () => clock.at, timeZone: () => 'UTC' }
  const ctx = contextFor({ ledger, announce: () => {}, time: clock })
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
    // About 70 ms warm; loose for a cold or busy runner. It is paid once per change, not once
    // per focus.
    expect(took).toBeLessThan(500)

    // The statement that ran, so the pinned plan is of the query that ships.
    const plan = recorded(() => listPaths(ledger.db)).map(({ sql }) =>
      ledger.db
        .prepare<[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => row.detail),
    )
    expect(plan).toEqual([
      // A few dozen accounts, each by its primary key, out to its postings and their transactions.
      // The sort is of those accounts' paths.
      [
        'SCAN a USING INDEX sqlite_autoindex_accounts_1',
        'SEARCH p USING COVERING INDEX postings_account_transaction (accountId=?) LEFT-JOIN',
        'SEARCH t USING INDEX sqlite_autoindex_transactions_1 (id=?) LEFT-JOIN',
        'USE TEMP B-TREE FOR ORDER BY',
      ],
    ])
  })
})
