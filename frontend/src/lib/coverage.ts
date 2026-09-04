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
