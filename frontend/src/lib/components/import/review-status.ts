import type { ParsedTransaction } from '$lib/api'
import type { RowState } from './row-state'

// Whether a row still needs a decision. Derived from recorded provenance rather than
// guessed from field values — a row pre-filled by a rule and a row the user deliberately
// assigned to the same account are indistinguishable by their fields alone.
export type RowStatus = 'skipped' | 'done' | 'auto' | 'needs-review'

export type ReviewFilter = 'all' | 'needs-review' | 'auto' | 'done' | 'skipped'

export const REVIEW_FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs-review', label: 'Needs review' },
  { id: 'auto', label: 'Auto' },
  { id: 'done', label: 'Done' },
  { id: 'skipped', label: 'Skipped' },
]

type StatusInput = Pick<RowState, 'skipped' | 'source'>

// Order matters: skipping is a decision that overrides where the assignment came from.
export function rowStatus(row: StatusInput): RowStatus {
  if (row.skipped) return 'skipped'
  if (row.source === 'user') return 'done'
  if (row.source === 'rule' || row.source === 'cluster') return 'auto'
  return 'needs-review'
}

export function matchesFilter(status: RowStatus, filter: ReviewFilter): boolean {
  return filter === 'all' || status === filter
}

export function statusCounts(rows: StatusInput[]): Record<ReviewFilter, number> {
  const counts: Record<ReviewFilter, number> = {
    all: rows.length,
    'needs-review': 0,
    auto: 0,
    done: 0,
    skipped: 0,
  }
  for (const row of rows) counts[rowStatus(row)]++
  return counts
}

// "18 of 42 reviewed" — everything that is no longer waiting on the user. An auto-applied
// row counts as reviewed because the Auto filter exists to audit it; a skipped row counts
// because skipping is itself a decision.
export function reviewedCount(rows: StatusInput[]): number {
  return rows.filter((r) => rowStatus(r) !== 'needs-review').length
}

// Index of the next row needing review at or after `from`, wrapping once. Returns -1 when
// nothing needs review.
export function nextUnreviewedIndex(rows: StatusInput[], from: number): number {
  if (rows.length === 0) return -1
  for (let offset = 1; offset <= rows.length; offset++) {
    const i = (from + offset + rows.length) % rows.length
    if (rowStatus(rows[i]) === 'needs-review') return i
  }
  return -1
}

// Rows an import rule with this pattern would claim, restricted to ones the user has not
// touched. Mirrors the backend's case-insensitive substring match (routes/import.ts) so a
// rule saved here back-fills exactly the rows the next import would pre-fill.
export function rowsMatchingPattern(
  transactions: ParsedTransaction[],
  rows: RowState[],
  pattern: string,
): number[] {
  const needle = pattern.trim().toLowerCase()
  if (!needle) return []
  const matches: number[] = []
  transactions.forEach((tx, i) => {
    const row = rows[i]
    if (!row || row.skipped || row.source !== 'none') return
    if ((tx.description ?? '').toLowerCase().includes(needle)) matches.push(i)
  })
  return matches
}

// Day boundaries for the review table's sticky headers. Returns the set of indices that
// open a new day, so the table stays one chronological list rather than being regrouped.
export function dayBoundaries(transactions: ParsedTransaction[], visible: number[]): Set<number> {
  const starts = new Set<number>()
  let previous = ''
  for (const i of visible) {
    const day = (transactions[i]?.date ?? '').slice(0, 10)
    if (day !== previous) {
      starts.add(i)
      previous = day
    }
  }
  return starts
}
