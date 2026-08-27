// What the dashboard says about catching up, if anything.
//
// This is the surface most likely to become nagging, so the constraints are the spec. Being
// behind is not broken data and must not borrow the vocabulary of something that is: no red,
// no warning badge, no sidebar dot, nothing shared with Action Required. The count is of
// accounts, never of days — "4 accounts to catch up" is a task, "63 days behind" is a verdict.

import type { CatchUpPayload } from '$lib/api'

export type TileState =
  // Say nothing at all.
  | { kind: 'hidden' }
  // Quiet good news, with a small check.
  | { kind: 'current'; label: string }
  // One neutral line and a way to make it stop.
  | { kind: 'behind'; label: string; accounts: number }

export function tileState(payload: CatchUpPayload | null, today: string): TileState {
  if (!payload || payload.summary.tracked === 0) return { kind: 'hidden' }

  // Bootstrap has not run, so every account reads maximally behind and the count would be
  // both alarming and meaningless. The coach asks for a starting line on its own page first.
  if (payload.summary.unset > 0) return { kind: 'hidden' }

  const behind = payload.summary.accountsToCatchUp
  if (behind === 0) return { kind: 'current', label: 'Ledger current' }

  // A snooze silences the ask, not the good news: if everything became current during one,
  // that still gets said. Suppressing a finish line the user earned would be a strange way to
  // honour a request for less noise.
  if (payload.snoozedUntil !== null && payload.snoozedUntil > today) return { kind: 'hidden' }

  return {
    kind: 'behind',
    label: `${behind} ${behind === 1 ? 'account' : 'accounts'} to catch up`,
    accounts: behind,
  }
}

// Whether a stored snooze is still in force. Compared as dates rather than instants: the
// snooze is set to a calendar day, and it should end when that day arrives wherever the user
// happens to be.
export function isSnoozed(snoozedUntil: string | null, today: string): boolean {
  return snoozedUntil !== null && snoozedUntil > today
}
