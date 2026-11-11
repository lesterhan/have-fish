// Every query the window's load runs after a change, at ten years: its plan, pinned, and the time
// the load takes. A new index can change the plan of a query nobody touched (see #608).

import { afterAll, describe, expect, test } from 'vitest'
import type { CommandName } from '../../shared/commands'
import { contextFor } from '../context'
import { aLedgerOf, NOW, openTempLedger, recorded } from '../ledger/fixtures'
import { runCommand } from './run'

/** What the window asks for after each change: `renderer/ledger.ts`'s load. */
const LOAD: [CommandName, unknown][] = [
  ['account.list', {}],
  ['spend.assumedFrom', {}],
  ['transaction.days', {}],
  ['transaction.page', { from: 0, limit: 100 }],
  ['transaction.get', { ids: ['00000000-0000-4000-8000-000000000000'] }],
]

describe('the load after a change, at ten years', { timeout: 120_000 }, () => {
  const temp = openTempLedger()
  afterAll(temp.dispose)
  const ledger = aLedgerOf(50_000, temp.ledger)
  const ctx = contextFor({
    ledger,
    announce: () => {},
    time: { now: () => NOW, timeZone: () => 'UTC' },
  })
  const log = { info() {}, error() {} }
  const load = () =>
    recorded(() => {
      for (const [name, input] of LOAD) expect(runCommand(ctx, name, input, log).ok).toBe(true)
    })
  load()

  test('each query reads an index, and only the one-row meta, the counts, the days and the balances read one whole', () => {
    const plans = load().map(({ sql, args }) =>
      ledger.db
        .prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...args)
        .map((row) => row.detail),
    )
    expect(plans).toEqual([
      // account.list: the starting balances, from the opening account out. The sort is of those.
      [
        'SCAN opening_account',
        'SEARCH opening_leg USING COVERING INDEX postings_account_transaction (accountId=?)',
        'SEARCH transactions USING INDEX sqlite_autoindex_transactions_1 (id=?)',
        'SEARCH postings USING INDEX sqlite_autoindex_postings_1 (transactionId=?)',
        'USE TEMP B-TREE FOR ORDER BY',
      ],
      // Each account's balance: the one index that covers it, whole.
      ['SCAN postings USING COVERING INDEX postings_account_balance'],
      // The accounts I have: a few dozen rows.
      ['SCAN accounts'],
      // spend.assumedFrom: the wallet, by its path.
      ['SEARCH accounts USING INDEX accounts_path_key (pathKey=?)', 'USE TEMP B-TREE FOR ORDER BY'],
      // transaction.days: each day's count, along the list's index, whose first column is the day.
      ['SCAN transactions USING COVERING INDEX transactions_listed'],
      // transaction.page: a page along the list's index, its total, its postings, and its days'
      // nets. Their sort is of the page's days' rows.
      ['SCAN transactions USING INDEX transactions_listed'],
      ['SCAN transactions USING COVERING INDEX transactions_listed'],
      // This ledger's device id, to say whether each row was made here: one row.
      ['SCAN meta'],
      [
        'SEARCH p USING INDEX sqlite_autoindex_postings_1 (transactionId=?)',
        'LIST SUBQUERY 1',
        'SCAN json_each VIRTUAL TABLE INDEX 1:',
        'SEARCH a USING INDEX sqlite_autoindex_accounts_1 (id=?) LEFT-JOIN',
      ],
      [
        'SEARCH t USING COVERING INDEX transactions_listed (date=?)',
        'LIST SUBQUERY 1',
        'SCAN json_each VIRTUAL TABLE INDEX 1:',
        'SEARCH p USING INDEX sqlite_autoindex_postings_1 (transactionId=?)',
        'SEARCH a USING INDEX sqlite_autoindex_accounts_1 (id=?)',
        'USE TEMP B-TREE FOR GROUP BY',
      ],
      // transaction.get: the kept rows, by id.
      [
        'SEARCH transactions USING INDEX sqlite_autoindex_transactions_1 (id=?)',
        'LIST SUBQUERY 1',
        'SCAN json_each VIRTUAL TABLE INDEX 1:',
      ],
    ])
  })

  test('the whole load is quick', () => {
    const took = load().reduce((sum, r) => sum + r.ms, 0)
    // Measured at about 22 ms, and 153 before #608's slowdown was fixed. Loose for a slow runner.
    expect(took).toBeLessThan(80)
  })
})
