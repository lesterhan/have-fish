import { describe, it, expect } from 'bun:test'
import {
  rowStatus,
  statusCounts,
  matchesFilter,
  reviewedCount,
  nextUnreviewedIndex,
  rowsMatchingPattern,
  dayBoundaries,
} from './review-status'
import type { RowState, RowSource } from './row-state'
import type { ParsedTransaction } from '$lib/api'

function row(source: RowSource, skipped = false): RowState {
  return {
    offsetAccountId: 'acct',
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

function tx(description: string, date = '2026-06-01'): ParsedTransaction {
  return { isTransfer: false, date, amount: '-10.00', description }
}

describe('rowStatus', () => {
  it('reads provenance, not field values', () => {
    expect(rowStatus(row('none'))).toBe('needs-review')
    expect(rowStatus(row('rule'))).toBe('auto')
    expect(rowStatus(row('cluster'))).toBe('auto')
    expect(rowStatus(row('user'))).toBe('done')
  })

  it('lets skipping override where the assignment came from', () => {
    // Skipping is itself a decision — a skipped row is not waiting on anything.
    expect(rowStatus(row('user', true))).toBe('skipped')
    expect(rowStatus(row('rule', true))).toBe('skipped')
    expect(rowStatus(row('none', true))).toBe('skipped')
  })
})

describe('statusCounts', () => {
  it('counts each status and totals under all', () => {
    const rows = [row('none'), row('none'), row('rule'), row('user'), row('none', true)]
    expect(statusCounts(rows)).toEqual({
      all: 5,
      'needs-review': 2,
      auto: 1,
      done: 1,
      skipped: 1,
    })
  })

  it('returns zeroes for an empty preview', () => {
    expect(statusCounts([])).toEqual({ all: 0, 'needs-review': 0, auto: 0, done: 0, skipped: 0 })
  })
})

describe('matchesFilter', () => {
  it('passes everything under all', () => {
    expect(matchesFilter('skipped', 'all')).toBe(true)
    expect(matchesFilter('needs-review', 'all')).toBe(true)
  })

  it('otherwise matches the status exactly', () => {
    expect(matchesFilter('auto', 'auto')).toBe(true)
    expect(matchesFilter('auto', 'done')).toBe(false)
  })
})

describe('reviewedCount', () => {
  it('counts everything no longer waiting on the user', () => {
    const rows = [row('none'), row('rule'), row('user'), row('none', true)]
    expect(reviewedCount(rows)).toBe(3)
  })

  it('is zero when nothing has been touched', () => {
    expect(reviewedCount([row('none'), row('none')])).toBe(0)
  })
})

describe('nextUnreviewedIndex', () => {
  it('finds the next unreviewed row after the current one', () => {
    const rows = [row('user'), row('none'), row('rule'), row('none')]
    expect(nextUnreviewedIndex(rows, 0)).toBe(1)
    expect(nextUnreviewedIndex(rows, 1)).toBe(3)
  })

  it('wraps around to the start', () => {
    const rows = [row('none'), row('user'), row('user')]
    expect(nextUnreviewedIndex(rows, 2)).toBe(0)
  })

  it('returns the same row when it is the only one left', () => {
    const rows = [row('user'), row('none'), row('user')]
    expect(nextUnreviewedIndex(rows, 1)).toBe(1)
  })

  it('returns -1 when nothing needs review', () => {
    expect(nextUnreviewedIndex([row('user'), row('rule')], 0)).toBe(-1)
    expect(nextUnreviewedIndex([], 0)).toBe(-1)
  })

  it('starts from before the first row when given -1', () => {
    expect(nextUnreviewedIndex([row('none'), row('none')], -1)).toBe(0)
  })
})

describe('rowsMatchingPattern', () => {
  const txs = [
    tx('LOBLAWS #042'),
    tx('LOBLAWS #117'),
    tx('BILLA'),
    tx('loblaws city market'),
  ]

  it('matches case-insensitively as a substring, like the backend does', () => {
    const rows = [row('none'), row('none'), row('none'), row('none')]
    expect(rowsMatchingPattern(txs, rows, 'LOBLAWS')).toEqual([0, 1, 3])
  })

  it('leaves rows the user already decided on alone', () => {
    const rows = [row('user'), row('none'), row('none'), row('none')]
    expect(rowsMatchingPattern(txs, rows, 'LOBLAWS')).toEqual([1, 3])
  })

  it('leaves auto-applied rows alone', () => {
    // A row a different rule already claimed is not up for grabs.
    const rows = [row('rule'), row('none'), row('none'), row('cluster')]
    expect(rowsMatchingPattern(txs, rows, 'LOBLAWS')).toEqual([1])
  })

  it('skips skipped rows', () => {
    const rows = [row('none', true), row('none'), row('none'), row('none')]
    expect(rowsMatchingPattern(txs, rows, 'LOBLAWS')).toEqual([1, 3])
  })

  it('returns nothing for an empty or whitespace pattern', () => {
    const rows = [row('none'), row('none'), row('none'), row('none')]
    expect(rowsMatchingPattern(txs, rows, '')).toEqual([])
    expect(rowsMatchingPattern(txs, rows, '   ')).toEqual([])
  })

  it('handles rows with no description', () => {
    const rows = [row('none')]
    expect(rowsMatchingPattern([{ isTransfer: false, date: '2026-06-01', amount: '-1.00' }], rows, 'X')).toEqual([])
  })
})

describe('dayBoundaries', () => {
  it('marks the first visible row of each day', () => {
    const txs = [
      tx('a', '2026-06-01'),
      tx('b', '2026-06-01'),
      tx('c', '2026-06-02'),
      tx('d', '2026-06-03'),
    ]
    expect([...dayBoundaries(txs, [0, 1, 2, 3])]).toEqual([0, 2, 3])
  })

  it('follows the filtered set, not the underlying rows', () => {
    // With row 0 filtered out, row 1 becomes the day's first visible row.
    const txs = [tx('a', '2026-06-01'), tx('b', '2026-06-01'), tx('c', '2026-06-02')]
    expect([...dayBoundaries(txs, [1, 2])]).toEqual([1, 2])
  })

  it('handles ISO timestamps by comparing the date part', () => {
    const txs = [tx('a', '2026-06-01T08:00:00Z'), tx('b', '2026-06-01T20:00:00Z')]
    expect([...dayBoundaries(txs, [0, 1])]).toEqual([0])
  })

  it('returns nothing for an empty selection', () => {
    expect([...dayBoundaries([], [])]).toEqual([])
  })
})
