import { describe, it, expect } from 'bun:test'
import {
  buildClusters,
  initialClusterState,
  clusterTarget,
  applyTarget,
  membersToWrite,
  userEditedCount,
  REMEMBER_THRESHOLD,
  type ClusterState,
} from './clustering'
import type { RowState, RowSource } from './row-state'
import type { ParsedTransaction } from '$lib/api'

function tx(
  merchantKey: string | undefined,
  date: string,
  amount: string,
  extra: Partial<ParsedTransaction> = {},
): ParsedTransaction {
  return { isTransfer: false, date, amount, description: merchantKey, merchantKey, ...extra } as ParsedTransaction
}

function row(source: RowSource = 'none', skipped = false): RowState {
  return {
    offsetAccountId: '',
    conversionAccountId: '',
    feeAccountId: '',
    skipped,
    groupId: null,
    categoryId: null,
    kind: 'spend',
    expenseAccountId: '',
    source,
  }
}

function state(overrides: Partial<ClusterState> = {}): ClusterState {
  return { key: 'LOBLAWS', accountId: '', groupId: null, categoryId: null, remember: false, excluded: [], ...overrides }
}

describe('buildClusters', () => {
  it('groups rows sharing a merchant stem', () => {
    const txs = [
      tx('LOBLAWS', '2026-06-03', '-40.00'),
      tx('BILLA', '2026-06-04', '-9.00'),
      tx('LOBLAWS', '2026-06-01', '-12.00'),
    ]
    const clusters = buildClusters(txs, 'CAD')
    expect(clusters).toHaveLength(1)
    expect(clusters[0].key).toBe('LOBLAWS')
    expect(clusters[0].indices).toEqual([2, 0]) // date order, not file order
  })

  it('leaves singletons out — there is no bulk in a bulk assign of one', () => {
    const txs = [tx('LOBLAWS', '2026-06-01', '-40.00'), tx('BILLA', '2026-06-02', '-9.00')]
    expect(buildClusters(txs, 'CAD')).toHaveLength(0)
  })

  it('ignores rows with no merchant stem', () => {
    const txs = [tx(undefined, '2026-06-01', '-1.00'), tx(undefined, '2026-06-02', '-2.00')]
    expect(buildClusters(txs, 'CAD')).toHaveLength(0)
  })

  it('orders by count descending, then alphabetically', () => {
    const txs = [
      tx('BILLA', '2026-06-01', '-1.00'),
      tx('BILLA', '2026-06-02', '-1.00'),
      tx('ALDI', '2026-06-01', '-1.00'),
      tx('ALDI', '2026-06-02', '-1.00'),
      tx('LOBLAWS', '2026-06-01', '-1.00'),
      tx('LOBLAWS', '2026-06-02', '-1.00'),
      tx('LOBLAWS', '2026-06-03', '-1.00'),
    ]
    expect(buildClusters(txs, 'CAD').map((c) => c.key)).toEqual(['LOBLAWS', 'ALDI', 'BILLA'])
  })

  it('reports the date range and summed spend', () => {
    const txs = [
      tx('LOBLAWS', '2026-06-27', '-12.50'),
      tx('LOBLAWS', '2026-06-03', '-40.00'),
    ]
    const [cluster] = buildClusters(txs, 'CAD')
    expect(cluster.firstDate).toBe('2026-06-03')
    expect(cluster.lastDate).toBe('2026-06-27')
    expect(cluster.total).toBeCloseTo(52.5, 2)
    expect(cluster.currency).toBe('CAD')
  })

  it('refuses to sum across currencies', () => {
    // Adding 40 EUR to 40 CAD would be a made-up number.
    const txs = [
      tx('LOBLAWS', '2026-06-01', '-40.00', { currency: 'CAD' }),
      tx('LOBLAWS', '2026-06-02', '-40.00', { currency: 'EUR' }),
    ]
    const [cluster] = buildClusters(txs, 'CAD')
    expect(cluster.total).toBeNull()
    expect(cluster.currency).toBeNull()
  })

  it('sums a cross-currency spend by what was actually spent', () => {
    const transfer = {
      isTransfer: true,
      date: '2026-06-01',
      merchantKey: 'PRAGUE CAFE',
      description: 'PRAGUE CAFE',
      sourceAmount: '-17.29',
      sourceCurrency: 'USD',
      targetAmount: '360.00',
      targetCurrency: 'CZK',
    } as ParsedTransaction
    const clusters = buildClusters([transfer, { ...transfer, date: '2026-06-02' }], 'CAD')
    expect(clusters[0].total).toBeCloseTo(720, 2)
    expect(clusters[0].currency).toBe('CZK')
  })

  it('surfaces the rule already covering a cluster', () => {
    const txs = [
      tx('STARBUCKS', '2026-06-01', '-5.00', { matchedRulePattern: 'starbucks' }),
      tx('STARBUCKS', '2026-06-02', '-5.00', { matchedRulePattern: 'starbucks' }),
    ]
    expect(buildClusters(txs, 'CAD')[0].matchedRulePattern).toBe('starbucks')
  })

  it('leaves matchedRulePattern null when no rule fired', () => {
    const txs = [tx('LOBLAWS', '2026-06-01', '-1.00'), tx('LOBLAWS', '2026-06-02', '-1.00')]
    expect(buildClusters(txs, 'CAD')[0].matchedRulePattern).toBeNull()
  })
})

describe('initialClusterState', () => {
  it('defaults remember on for a habit and off for a pair', () => {
    const pair = buildClusters(
      [tx('BILLA', '2026-06-01', '-1.00'), tx('BILLA', '2026-06-02', '-1.00')],
      'CAD',
    )[0]
    const habit = buildClusters(
      Array.from({ length: REMEMBER_THRESHOLD }, (_, i) => tx('LOBLAWS', `2026-06-0${i + 1}`, '-1.00')),
      'CAD',
    )[0]
    expect(initialClusterState(pair).remember).toBe(false)
    expect(initialClusterState(habit).remember).toBe(true)
  })

  it('defaults remember off when a rule already covers the cluster', () => {
    // Remembering here would write a second rule with the same pattern rather than
    // correcting the one that fired.
    const covered = buildClusters(
      Array.from({ length: REMEMBER_THRESHOLD }, (_, i) =>
        tx('LOBLAWS', `2026-06-0${i + 1}`, '-1.00', { matchedRulePattern: 'loblaws' }),
      ),
      'CAD',
    )[0]
    expect(initialClusterState(covered).remember).toBe(false)
  })
})

describe('clusterTarget', () => {
  it('prefers a split when one is set', () => {
    expect(clusterTarget(state({ accountId: 'a', groupId: 'g', categoryId: 'c' }))).toEqual({
      kind: 'split',
      groupId: 'g',
      categoryId: 'c',
    })
  })

  it('falls back to the account', () => {
    expect(clusterTarget(state({ accountId: 'a' }))).toEqual({ kind: 'account', accountId: 'a' })
  })

  it('is null when nothing is chosen', () => {
    expect(clusterTarget(state())).toBeNull()
  })
})

describe('applyTarget', () => {
  it('writes a regular row’s offset account', () => {
    const result = applyTarget(tx('X', '2026-06-01', '-1.00'), row(), { kind: 'account', accountId: 'acct' }, 'cluster')
    expect(result.offsetAccountId).toBe('acct')
    expect(result.source).toBe('cluster')
  })

  it('writes a cross-currency spend’s expense account instead', () => {
    const transfer = { isTransfer: true, date: '2026-06-01', sourceAmount: '-1', sourceCurrency: 'USD', targetAmount: '1', targetCurrency: 'CZK' } as ParsedTransaction
    const result = applyTarget(transfer, row(), { kind: 'account', accountId: 'acct' }, 'cluster')
    expect(result.expenseAccountId).toBe('acct')
    expect(result.offsetAccountId).toBe('')
  })

  it('clears a stale split when assigning an account', () => {
    const existing = { ...row(), groupId: 'g', categoryId: 'c' }
    const result = applyTarget(tx('X', '2026-06-01', '-1.00'), existing, { kind: 'account', accountId: 'acct' }, 'cluster')
    expect(result.groupId).toBeNull()
    expect(result.categoryId).toBeNull()
  })

  it('writes a split target', () => {
    const result = applyTarget(tx('X', '2026-06-01', '-1.00'), row(), { kind: 'split', groupId: 'g', categoryId: 'c' }, 'cluster')
    expect(result.groupId).toBe('g')
    expect(result.categoryId).toBe('c')
  })
})

describe('membersToWrite', () => {
  const cluster = buildClusters(
    [
      tx('LOBLAWS', '2026-06-01', '-1.00'),
      tx('LOBLAWS', '2026-06-02', '-1.00'),
      tx('LOBLAWS', '2026-06-03', '-1.00'),
    ],
    'CAD',
  )[0]

  it('writes every untouched member', () => {
    const rows = [row(), row(), row()]
    expect(membersToWrite(cluster, state(), rows, false)).toEqual([0, 1, 2])
  })

  it('leaves hand-edited rows alone', () => {
    // Review → Sort → Review must not stomp a decision already made.
    const rows = [row(), row('user'), row()]
    expect(membersToWrite(cluster, state(), rows, false)).toEqual([0, 2])
  })

  it('includes hand-edited rows when overriding', () => {
    const rows = [row(), row('user'), row()]
    expect(membersToWrite(cluster, state(), rows, true)).toEqual([0, 1, 2])
  })

  it('respects members peeled out of the assign', () => {
    const rows = [row(), row(), row()]
    expect(membersToWrite(cluster, state({ excluded: [1] }), rows, false)).toEqual([0, 2])
  })

  it('never writes a skipped row, even when overriding', () => {
    const rows = [row(), row('none', true), row()]
    expect(membersToWrite(cluster, state(), rows, true)).toEqual([0, 2])
  })

  it('overwrites rule- and cluster-assigned rows without needing override', () => {
    // Only a human decision is protected; an earlier automatic assignment is not.
    const rows = [row('rule'), row('cluster'), row()]
    expect(membersToWrite(cluster, state(), rows, false)).toEqual([0, 1, 2])
  })
})

describe('userEditedCount', () => {
  const cluster = buildClusters(
    [tx('LOBLAWS', '2026-06-01', '-1.00'), tx('LOBLAWS', '2026-06-02', '-1.00')],
    'CAD',
  )[0]

  it('counts the hand-edited members an override would claim', () => {
    expect(userEditedCount(cluster, state(), [row('user'), row()])).toBe(1)
    expect(userEditedCount(cluster, state(), [row('user'), row('user')])).toBe(2)
    expect(userEditedCount(cluster, state(), [row(), row()])).toBe(0)
  })

  it('ignores excluded and skipped members', () => {
    expect(userEditedCount(cluster, state({ excluded: [0] }), [row('user'), row()])).toBe(0)
    expect(userEditedCount(cluster, state(), [row('user', true), row()])).toBe(0)
  })
})
