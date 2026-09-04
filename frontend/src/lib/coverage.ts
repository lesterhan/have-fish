// Dating a total.
//
// DESIGN.md §1: a rollup is only as current as its stalest live contributor, and it says so.
// This is that sentence as a function. Every surface that adds account figures together —
// the accounts page tiles, the spending totals, the status bar — reads its as-of from here,
// so two rollups over the same accounts can never quote different dates.

// Mirrors the backend's CatchUpState. 'unset' means no coverage has ever been asserted for
// the account, which is not the same as being behind: nothing is known either way.
export type CoverageState = 'current' | 'behind' | 'unset'

// One row of GET /api/coverage/accounts. An account absent from that payload is absent here
// too, and is not a contributor at all — see the endpoint's comment for why.
export type AccountCoverageStatus = {
  accountId: string
  state: CoverageState
  coveredThrough: string | null
  dormant: boolean
}

export type Completeness = {
  // The date the set is complete through: the oldest leading edge among live contributors
  // that are behind. Null when no live contributor is behind, which is the caught-up case.
  through: string | null
  // Live contributors that have never asserted coverage. They cannot be dated at all, so any
  // number above zero means `through` is the best available answer rather than a guarantee —
  // a caller that renders a date without checking this is making a promise the data doesn't
  // support. Kept separate rather than collapsed into `through: null` precisely because
  // "nothing to report" and "nothing known" are the two states this whole epic exists to
  // stop the app from confusing.
  unknown: number
  // How many rows were counted as contributors at all. Zero means the set has nothing to be
  // complete or incomplete about, and a caller should say nothing rather than say "today".
  contributors: number
}

// Dormant accounts are excluded, not merely ranked last. An account confirmed empty for a
// month, with nothing landing in its open gap, has nothing to add to a total — so being
// behind on it cannot make the total wrong, and letting it set the date would make every
// rollup permanently stale over an account that will never move again.
export function completeness(rows: AccountCoverageStatus[]): Completeness {
  let through: string | null = null
  let unknown = 0
  let contributors = 0

  for (const row of rows) {
    if (row.dormant) continue
    contributors++

    if (row.state === 'current') continue
    // A behind account with no leading edge shouldn't exist — the backend only reaches
    // 'behind' by reading one off. Counting it as unknown rather than ignoring it means a
    // shape that shouldn't happen degrades into honesty rather than into a false date.
    if (row.state === 'unset' || row.coveredThrough === null) {
      unknown++
      continue
    }
    // Lexicographic comparison on 'YYYY-MM-DD' is chronological comparison.
    if (through === null || row.coveredThrough < through) through = row.coveredThrough
  }

  return { through, unknown, contributors }
}

// Narrows a coverage payload to the accounts a single rollup sums, so a tile can date itself
// from its own contributors rather than from the whole ledger. Ids with no coverage row drop
// out, which is the intended reading: they are not contributors.
export function coverageFor(
  byAccountId: Map<string, AccountCoverageStatus>,
  accountIds: Iterable<string>,
): AccountCoverageStatus[] {
  const rows: AccountCoverageStatus[] = []
  for (const id of accountIds) {
    const row = byAccountId.get(id)
    if (row) rows.push(row)
  }
  return rows
}

// ── Saying it ───────────────────────────────────────────────

// 'Jun 21', or 'Jun 21, 2025' once the year stops being obvious. A bare month and day from
// a previous year reads as recent, which is the opposite of what a staleness date is for.
export function formatCompletenessDate(date: string, today: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  const sameYear = date.substring(0, 4) === today.substring(0, 4)
  return parsed.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export type CompletenessNote = {
  // The line the surface renders, at --text-xs in --color-text-muted. Sentence fragments,
  // lower case: it sits under a figure as a qualifier, not above one as a heading.
  text: string
  // The whole sentence, for a title attribute. The short line has to fit under a tile; this
  // is where the count, the date and the way out of it go.
  detail: string
  // True when nothing is outstanding. Surfaces that want to distinguish "all clear" from a
  // real date read this rather than testing the string.
  current: boolean
}

const accounts = (n: number) => `${n} ${n === 1 ? 'account' : 'accounts'}`

// One phrasing for every surface that dates a total, so the accounts tiles, the spending
// page and the status bar cannot end up describing the same coverage three ways.
//
// Returns null when the set has no contributors at all: a tile summing only accounts the
// user has hidden or flagged has nothing to be complete or incomplete about, and "complete
// through today" would be an answer to a question nobody asked.
export function completenessNote(c: Completeness, today: string): CompletenessNote | null {
  if (c.contributors === 0) return null

  // Unknown outranks a date, even when both are present. An account whose coverage has never
  // been asserted could be missing anything, so a date computed from the others would be an
  // upper bound rendered as a fact — and the caveat always loses to the number (§4).
  if (c.unknown > 0) {
    return {
      text: `coverage unknown for ${accounts(c.unknown)}`,
      detail:
        `${c.unknown} of the ${accounts(c.contributors)} in this figure have never had their ` +
        `coverage recorded, so there is no date it is complete through. Record it in Catch Up.`,
      current: false,
    }
  }

  if (c.through !== null) {
    const when = formatCompletenessDate(c.through, today)
    return {
      text: `complete through ${when}`,
      detail:
        `Complete through ${when} — the oldest account in this figure stops there. ` +
        `Anything after that date is not in it yet.`,
      current: false,
    }
  }

  return {
    text: 'complete through today',
    detail: 'Every account in this figure is recorded up to its latest available data.',
    current: true,
  }
}
