// The app's places down the left.

import type { KeyedActionId, WindowActionId } from '../../shared/actions'
import type { Moved } from '../../shared/commands'

export const PLACES = ['ledger', 'accounts', 'reports'] as const
export type Place = (typeof PLACES)[number]

/** What App asks of every place. */
export type PlaceView = {
  /** Puts the cursor in it. */
  focus(): void
  /** Selects the item with this id. */
  show(id: string): Promise<void>
  /** Says why an undo or redo changed nothing. */
  refused(words: string): void
}

/** A place that lists the ledger's spends: Remove, Refile and Show postings act there. */
export type SpendView = PlaceView & {
  remove(): Promise<void>
  /** The selected spend's To, as a path picker in its row. */
  refile(): void
  /** The open spend's postings, shown or hidden. */
  postings(): void
}

/** The action that goes to each place, so the sidebar can show its shortcut. */
export const SHOW = {
  ledger: 'showLedger',
  accounts: 'showAccounts',
  reports: 'showReports',
} as const satisfies Record<Place, WindowActionId & KeyedActionId>

/** The places that list spends: Remove, Refile and Show postings act there and nowhere else. */
const SPEND_PLACES = ['ledger', 'reports'] as const satisfies readonly Place[]

export const listsSpends = (place: Place): place is (typeof SPEND_PLACES)[number] =>
  (SPEND_PLACES as readonly Place[]).includes(place)

type ShowAction = (typeof SHOW)[Place]

/** A handler for each place's action in SHOW, going to that place. */
export function showHandlers(go: (place: Place) => void): Record<ShowAction, () => void> {
  // fromEntries types its keys as string; PLACES and SHOW name every one.
  return Object.fromEntries(PLACES.map((p) => [SHOW[p], () => go(p)])) as Record<
    ShowAction,
    () => void
  >
}

/**
 * Where an undo or redo's change is, and what to select there; null if it changed nothing. A
 * spend shows where I am when that's Reports, which lists spends too.
 */
export function shownBy(moved: Moved, here: Place): { place: Place; id: string } | null {
  const [spend] = moved.spends
  if (spend !== undefined) return { place: here === 'reports' ? here : 'ledger', id: spend }
  const [account] = moved.accounts
  if (account !== undefined) return { place: 'accounts', id: account }
  return null
}
