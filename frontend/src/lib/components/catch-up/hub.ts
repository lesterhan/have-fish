// Copy and grouping for the hub.
//
// The tone rules live here as much as the logic does. Being behind is not broken data, and
// none of this may borrow the vocabulary of something that is: no red, no warnings, no counts
// of days. An account count is actionable; "63 days behind" is only guilt.

import type { CatchUpAccount } from '$lib/api'

export type HubGroups = {
  // Accounts with an open gap, smallest first — the queue proper.
  behind: CatchUpAccount[]
  // Covered to their horizon. Collapsed to one quiet line each.
  current: CatchUpAccount[]
  // Quiet accounts, below a divider and collapsed. Ranking only — a dormant account with a
  // real gap is still shown, just last.
  dormant: CatchUpAccount[]
}

// The payload arrives already ordered (smallest gap first, dormant last), so grouping only
// splits the list — it never re-sorts and cannot disagree with the server's ranking.
export function groupAccounts(accounts: CatchUpAccount[]): HubGroups {
  return {
    behind: accounts.filter((a) => !a.dormant && a.state === 'behind'),
    current: accounts.filter((a) => !a.dormant && a.state === 'current'),
    dormant: accounts.filter((a) => a.dormant),
  }
}

export function displayName(account: CatchUpAccount): string {
  return account.name ?? account.path
}

// The estimate, floored at what is already known to be sitting in the gap.
//
// The raw server estimate is a rate extrapolation and knows nothing about the transactions
// already entered, so a sparse account can produce "~0 transactions" on a gap that visibly
// holds two days of phone-entered splits. Printing both is a contradiction, and the one that
// reads as "nothing to do here" is the dangerous half — it sits directly above a button that
// marks the whole range covered. A count of days already holding transactions is a hard lower
// bound on the truth, so the estimate never goes below it.
export function expectedForDisplay(account: CatchUpAccount): number | null {
  if (account.expectedTxns === null) return null
  return Math.max(account.expectedTxns, account.txnDatesInGap.length)
}

// The size of the job, in the units that make it feel finishable. Days first because that is
// what the user acts on; the transaction estimate second because it is an estimate.
export function gapSummary(account: CatchUpAccount): string | null {
  if (!account.gap) return null

  const days = `${account.gap.days} ${account.gap.days === 1 ? 'day' : 'days'}`
  const expected = expectedForDisplay(account)
  if (expected === null) return days
  return `${days} · ~${expected} ${expected === 1 ? 'transaction' : 'transactions'}`
}

// The one-line status for an account that needs nothing. A cycle account says when its next
// statement lands, so a card sitting at "current" for three weeks explains itself rather than
// looking stalled.
export function currentSummary(account: CatchUpAccount): string {
  if (account.horizonReason === 'statement' && account.nextHorizonDate) {
    return `Current · next statement ${account.nextHorizonDate}`
  }
  return 'Current'
}

// What "nothing happened here" would assert, spelled out before the user clicks it.
export function emptyActionLabel(account: CatchUpAccount): string | null {
  if (!account.gap) return null
  return `Marks ${account.gap.from} through ${account.gap.through} as covered`
}

// Transactions already sitting inside the open window. Worth calling out, because a month
// holding three phone-entered splits looks finished in the transaction list when it is not.
export function enteredInGapNote(account: CatchUpAccount): string | null {
  const count = account.txnDatesInGap.length
  if (count === 0) return null
  return count === 1
    ? '1 day in this range already has transactions'
    : `${count} days in this range already have transactions`
}

// Progress toward "everything is current", as a percentage for the bar.
//
// No tracked accounts reads as complete rather than as zero: a user with nothing to track is
// not 0% done, and showing an empty bar would invent a job that does not exist.
export function progressPercent(current: number, tracked: number): number {
  if (tracked === 0) return 100
  return Math.round((current / tracked) * 100)
}

// The headline above the bar. Counts accounts, never days.
export function progressLabel(current: number, tracked: number): string {
  if (tracked === 0) return 'Nothing to track yet'
  if (current === tracked) return 'Ledger current'
  return `${current} of ${tracked} accounts current`
}

// Copy for the calm panel that replaces the queue when there is nothing active to do.
//
// A dormant account with an open gap keeps the progress count below full, so claiming
// "everything is caught up" next to a bar reading 2 of 3 would be a plain contradiction. But
// requiring dormant accounts to be current before the page can ever go quiet would mean a
// permanently quiet account nags forever, which is the thing this feature must not do. So the
// panel says what is actually true: nothing active is waiting, and the quiet ones are parked
// below rather than finished.
export function donePanelCopy(groups: HubGroups): { headline: string; note: string } {
  const parked = groups.dormant.filter((a) => a.gap !== null).length

  if (parked === 0) {
    return {
      headline: 'Everything is caught up.',
      note: 'Nothing to enter right now. Come back when a statement lands — the coach will be here.',
    }
  }

  return {
    headline: 'Nothing active to catch up.',
    note: parked === 1
      ? '1 quiet account is still uncovered, waiting below whenever you want it.'
      : `${parked} quiet accounts are still uncovered, waiting below whenever you want them.`,
  }
}

// --- focus mode ---

// Where the focus queue should land, given who is left and who was being worked on.
//
// Resuming by account id rather than by index is what makes returning from an import land in
// the right place: a successful import removes that account from the queue entirely, so an
// index would silently point at whatever slid into the slot. By id, a finished account falls
// through to the next one and an unfinished one is still there waiting.
export function resolveFocus(queue: CatchUpAccount[], rememberedId: string | null): number {
  if (queue.length === 0) return -1
  if (!rememberedId) return 0
  const index = queue.findIndex((a) => a.accountId === rememberedId)
  return index === -1 ? 0 : index
}

// "2 of 5" — position in the queue, one-based for humans.
export function focusPosition(index: number, total: number): string {
  return `${index + 1} of ${total}`
}

// The import handoff URL. The range is the account's open gap, which ends at the horizon
// rather than at today — asking a bank for days it has not published yet is asking for a file
// that cannot exist.
export function importHref(account: CatchUpAccount): string {
  const params = new URLSearchParams({ account: account.accountId, return: 'catch-up' })
  if (account.gap) {
    params.set('from', account.gap.from)
    params.set('to', account.gap.through)
  }
  return `/import?${params.toString()}`
}
