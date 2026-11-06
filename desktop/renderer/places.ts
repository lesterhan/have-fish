// The app's places down the left: each a list beside a pane.

import type { KeyedActionId, WindowActionId } from '../shared/actions'
import type { Moved } from '../shared/commands'

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

/** A place that keeps drafts of spends: Save all and Remove spend act there. */
export type DraftsView = PlaceView & {
  saveAll(): void
  remove(): Promise<void>
}

/** The action that goes to each place, so the sidebar can show its shortcut. */
export const SHOW: Record<Place, WindowActionId & KeyedActionId> = {
  ledger: 'showLedger',
  accounts: 'showAccounts',
  reports: 'showReports',
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
