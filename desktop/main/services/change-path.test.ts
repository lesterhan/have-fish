// Every query the window's load runs after a change, at ten years: its plan, pinned, and the time
// the load takes. A new index can change the plan of a query nobody touched (see #608).

import Database from 'better-sqlite3'
import { afterAll, describe, expect, test } from 'vitest'
import type { CommandName } from '../../shared/commands'
import { runCommand } from '../commands/run'
import { contextFor } from '../context'
import { aLedgerOf, NOW, openTempLedger } from '../ledger/fixtures'

/** What the window asks for after each change: `renderer/ledger.ts`'s load. */
const LOAD: [CommandName, unknown][] = [
  ['account.list', {}],
  ['category.list', {}],
  ['income.list', {}],
  ['spend.assumedFrom', {}],
  ['transaction.page', { from: 0, limit: 100 }],
  ['transaction.get', { ids: ['00000000-0000-4000-8000-000000000000'] }],
]

type Ran = { sql: string; args: unknown[]; ms: number }

/** Each statement run while `during` does, with its arguments and how long it took. */
function recorded(during: () => void): Ran[] {
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

describe('the load after a change, at ten years', { timeout: 120_000 }, () => {
  const temp = openTempLedger()
  afterAll(temp.dispose)
  const ledger = aLedgerOf(50_000, temp.ledger)
  const ctx = contextFor(ledger, () => {}, { now: () => NOW, timeZone: () => 'UTC' })
  const log = { info() {}, error() {} }
  const load = () =>
    recorded(() => {
      for (const [name, input] of LOAD) expect(runCommand(ctx, name, input, log).ok).toBe(true)
    })
  load()

  test('each query reads an index, and only the counts and the balances read one whole', () => {
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
      // category.list, then income.list: how many spends each is in, with no sort.
      [
        'SCAN accounts USING INDEX sqlite_autoindex_accounts_1',
        'SEARCH postings USING COVERING INDEX postings_account_transaction (accountId=?)',
      ],
      [
        'SCAN accounts USING INDEX sqlite_autoindex_accounts_1',
        'SEARCH postings USING COVERING INDEX postings_account_transaction (accountId=?)',
      ],
      // spend.assumedFrom: the wallet, by its path.
      ['SEARCH accounts USING INDEX accounts_path_key (pathKey=?)', 'USE TEMP B-TREE FOR ORDER BY'],
      // transaction.page: a page along the list's index, its total, and its postings.
      ['SCAN transactions USING INDEX transactions_listed'],
      ['SCAN transactions USING COVERING INDEX transactions_listed'],
      [
        'SEARCH p USING INDEX sqlite_autoindex_postings_1 (transactionId=?)',
        'LIST SUBQUERY 1',
        'SCAN json_each VIRTUAL TABLE INDEX 1:',
        'SEARCH a USING INDEX sqlite_autoindex_accounts_1 (id=?) LEFT-JOIN',
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
