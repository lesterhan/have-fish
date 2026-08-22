// Coalescing coverage assertions into the spans a reader can reason about.
//
// Rows in account_coverage are raw assertions — they overlap, nest, and repeat, because
// nothing stops a user importing the same statement twice or reconciling inside a range an
// import already covered. Every reader therefore runs the raw rows through mergeCoverage()
// first; the merged spans are what "covered through D" and "the gap starts here" are read off.

// An inclusive [fromDate, throughDate] range. Dates are ISO 'YYYY-MM-DD' strings throughout,
// matching the `date` columns, so lexicographic comparison is also chronological comparison.
export type CoverageInterval = {
  fromDate: string
  throughDate: string
}

// Day arithmetic on 'YYYY-MM-DD' strings, done in UTC so a machine in a negative-offset
// timezone can't shift a date across midnight and quietly move a boundary.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().substring(0, 10)
}

// Whole days from `from` to `to`, signed. Both parse as UTC midnight, so the division is
// exact — no DST hour to round away.
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

// Coalesces overlapping and adjacent intervals into the smallest set of disjoint spans,
// sorted ascending by start date.
//
// Adjacency is the subtle half: Jun 1-30 and Jul 1-31 do NOT overlap, but there is no
// uncovered day between them, so they must come back as one span Jun 1 - Jul 31. Merging
// only on overlap would manufacture a phantom gap at every month boundary — which, since
// most coverage arrives as monthly statements, would mean a fabricated gap nearly everywhere.
// Hence `next.fromDate <= prev.throughDate + 1 day` rather than `<= prev.throughDate`.
export function mergeCoverage(intervals: CoverageInterval[]): CoverageInterval[] {
  if (intervals.length === 0) return []

  // Sort by start, then by end. Sorting by start alone is enough for correctness (the running
  // span's end is tracked as a max), but the tiebreak keeps the output stable for tests.
  const sorted = [...intervals].sort((a, b) =>
    a.fromDate === b.fromDate
      ? a.throughDate.localeCompare(b.throughDate)
      : a.fromDate.localeCompare(b.fromDate),
  )

  const merged: CoverageInterval[] = []
  let current = { fromDate: sorted[0].fromDate, throughDate: sorted[0].throughDate }

  for (const next of sorted.slice(1)) {
    if (next.fromDate <= addDays(current.throughDate, 1)) {
      // Overlapping, nested, or adjacent — absorb it. Max, not assignment: a fully nested
      // interval (Jul 10-15 inside Jul 1-31) must not pull the span's end backwards.
      if (next.throughDate > current.throughDate) current.throughDate = next.throughDate
    } else {
      merged.push(current)
      current = { fromDate: next.fromDate, throughDate: next.throughDate }
    }
  }
  merged.push(current)

  return merged
}
