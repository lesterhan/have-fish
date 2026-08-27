// Turning coverage into day cells.
//
// The honest answer to "which dates do I need" is a range, not a list: only the bank knows
// which days inside an unimported window actually hold transactions. So the strip shows the
// shape of what is known — covered, uncovered, not-yet-obtainable — and marks the days that
// already have something in them, which is the one part the app can state as fact.

export type CoverageDayState =
  // Asserted complete.
  | 'covered'
  // Unknown. This is the honest answer to "which dates do I need".
  | 'uncovered'
  // Past the horizon — the bank has not published it yet. Emphatically not a gap, and never
  // counted as work.
  | 'beyond-horizon'

export type CoverageDay = {
  date: string
  state: CoverageDayState
  // A day with transactions already entered. On an uncovered cell this is the phone-entered
  // split sitting inside an open gap — evidence the account is live, never evidence the range
  // is complete. The epic's fourth visual state is this flag on an 'uncovered' cell.
  hasTxn: boolean
  // Set on the first cell of a month (and on the first cell of the window), for the ruler.
  monthLabel: string | null
}

export type BuildStripInput = {
  from: string
  to: string
  intervals: { fromDate: string; throughDate: string }[]
  horizon: string
  txnDates: string[]
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().substring(0, 10)
}

function monthNameOf(date: string): string {
  return MONTHS[Number(date.substring(5, 7)) - 1]
}

function startOfNextMonth(date: string): string {
  const year = Number(date.substring(0, 4))
  const month = Number(date.substring(5, 7))
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`
}

export function daysApart(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

// A day cell is only a few pixels wide, so two month labels closer together than this overlap
// into an unreadable smudge. When the window opens near the end of a month, the leading label
// is dropped and the month boundary's own label speaks for both.
const MIN_LABEL_GAP_DAYS = 6

export function buildStrip({ from, to, intervals, horizon, txnDates }: BuildStripInput): CoverageDay[] {
  if (from > to) return []

  const txns = new Set(txnDates)
  const days: CoverageDay[] = []

  // Whether the opening cell gets a label depends on how soon the next month starts, so it
  // has to be decided before the loop rather than at the moment the first cell is built.
  const firstOfNextMonth = startOfNextMonth(from)
  const labelFirstCell = firstOfNextMonth > to || daysApart(from, firstOfNextMonth) >= MIN_LABEL_GAP_DAYS

  for (let date = from; date <= to; date = addDays(date, 1)) {
    // Covered wins over beyond-horizon. A day the user has actually asserted is complete is
    // complete, even if it sits past a statement boundary — showing it as unavailable would
    // contradict a fact already recorded.
    const covered = intervals.some((i) => date >= i.fromDate && date <= i.throughDate)
    const state: CoverageDayState = covered
      ? 'covered'
      : date > horizon
        ? 'beyond-horizon'
        : 'uncovered'

    const startsMonth = date.substring(8, 10) === '01'
    const isFirstCell = days.length === 0
    days.push({
      date,
      state,
      hasTxn: txns.has(date),
      monthLabel:
        startsMonth || (isFirstCell && labelFirstCell) ? monthNameOf(date) : null,
    })
  }

  return days
}

// Hover text for one cell. Says what the day is, not what the user should do about it — the
// strip is a picture of the facts, and the actions live elsewhere on the page.
export function describeDay(day: CoverageDay): string {
  const suffix = day.hasTxn ? ' · has transactions' : ''

  switch (day.state) {
    case 'covered':
      return `${day.date} · covered${suffix}`
    case 'beyond-horizon':
      return `${day.date} · not yet available${suffix}`
    case 'uncovered':
      return `${day.date} · not covered${suffix}`
  }
}

// Counts for the strip's caption, so the picture has a number next to it.
export function summarizeStrip(days: CoverageDay[]) {
  return {
    covered: days.filter((d) => d.state === 'covered').length,
    uncovered: days.filter((d) => d.state === 'uncovered').length,
    beyondHorizon: days.filter((d) => d.state === 'beyond-horizon').length,
    // Transactions sitting in days that are not asserted complete — the mixed state that makes
    // a month look done when it is not.
    txnsInUncovered: days.filter((d) => d.state === 'uncovered' && d.hasTxn).length,
  }
}

// The strip is a picture, so screen readers get the same facts as prose.
export function ariaSummary(counts: ReturnType<typeof summarizeStrip>, from: string, to: string): string {
  const parts = [`${counts.covered} covered`, `${counts.uncovered} not covered`]
  if (counts.beyondHorizon > 0) parts.push(`${counts.beyondHorizon} not yet available`)
  return `Coverage from ${from} to ${to}: ${parts.join(', ')}.`
}
