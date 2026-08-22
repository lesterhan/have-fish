// Proposing a starting line.
//
// On the day the coach ships, no account has a single coverage row, so every account reads
// maximally behind. For a feature whose whole premise is not nagging, that is the worst
// possible first impression — and there is no import history to reconstruct real coverage
// from, so the app has to ask once instead.
//
// The proposal is deliberately generous: the user has been using the app, so whatever is
// already in the ledger is presumed real and asserted complete in one action.

import type { CatchUpAccount, CoverageSource } from '$lib/api'

export type StartingLineProposal = {
  accountId: string
  path: string
  name: string | null
  fromDate: string
  throughDate: string
  source: CoverageSource
  // True when the account has no transactions at all, so the proposal is a single day at
  // today rather than a span of real history. Worth saying out loud in the UI — the user
  // should know this row is asserting "nothing has happened here", not "this is all entered".
  noHistory: boolean
}

// One proposal per account with no coverage yet.
//
// With history: the account's whole existing span, first transaction through last. With none:
// a single day at today, recorded as 'empty' rather than 'manual' — the honest provenance is
// "the user confirmed nothing happened", not "the user vouched for imported data".
export function proposeStartingLines(
  accounts: CatchUpAccount[],
  today: string,
): StartingLineProposal[] {
  return accounts
    .filter((a) => a.state === 'unset')
    .map((account) => {
      const noHistory = account.firstTxnDate == null || account.lastTxnDate == null

      return {
        accountId: account.accountId,
        path: account.path,
        name: account.name,
        fromDate: noHistory ? today : account.firstTxnDate!,
        throughDate: noHistory ? today : account.lastTxnDate!,
        source: (noHistory ? 'empty' : 'manual') satisfies CoverageSource as CoverageSource,
        noHistory,
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

// Whether an edited proposal can be written. The backend enforces the same rule, but catching
// it here keeps the user from firing off a batch where one row will bounce.
export function isValidProposal(proposal: { fromDate: string; throughDate: string }): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(proposal.fromDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(proposal.throughDate) &&
    proposal.fromDate <= proposal.throughDate
  )
}

// A one-line summary of what accepting a row asserts, shown next to it so "accept all" is
// never a leap of faith.
export function describeProposal(proposal: StartingLineProposal): string {
  if (proposal.noHistory) return 'No transactions yet — marks today as covered'
  if (proposal.fromDate === proposal.throughDate) return `Marks ${proposal.fromDate} as covered`
  return `Marks ${proposal.fromDate} through ${proposal.throughDate} as covered`
}
