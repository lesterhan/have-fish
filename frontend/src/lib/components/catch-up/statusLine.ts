import { daysApart } from './coverageStrip'

/**
 * The one-line coverage status for the account page.
 *
 * This replaces a card that spent ~120px saying one sentence. The sentence is still the
 * point; the 90-day picture moves behind a disclosure. Wording follows the catch-up hub
 * (`currentSummary` / `gapSummary`) so the two surfaces speak the same language.
 */
export type CoverageStatus = {
  text: string
  /** Open days between the last covered day and the horizon; 0 when nothing is open. */
  daysOpen: number
}

type CoverageLike = {
  intervals: { fromDate: string; throughDate: string }[]
  horizon: string
  nextHorizon: string | null
}

export function statusLine(coverage: CoverageLike): CoverageStatus {
  const latest = coverage.intervals[0]

  if (!latest) {
    return { text: 'Nothing recorded yet', daysOpen: 0 }
  }

  if (latest.throughDate >= coverage.horizon) {
    // A cycle account says when the next statement lands, so an account sitting at
    // "current" for three weeks explains itself rather than looking stalled.
    const text = coverage.nextHorizon
      ? `Current · next statement ${coverage.nextHorizon}`
      : 'Current'
    return { text, daysOpen: 0 }
  }

  // Covered through D means D itself is done, so the open stretch starts the next day —
  // an inclusive count from D+1 to the horizon, which is exactly daysApart(D, horizon).
  const daysOpen = daysApart(latest.throughDate, coverage.horizon)
  const unit = daysOpen === 1 ? 'day' : 'days'
  return {
    text: `Covered through ${latest.throughDate} · ${daysOpen} ${unit} open`,
    daysOpen,
  }
}
