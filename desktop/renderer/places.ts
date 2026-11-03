// The app's places down the left: each a list beside a pane.

import type { WindowActionId } from '../shared/actions'
import type { Moved } from '../shared/commands'

export const PLACES = ['spends', 'accounts'] as const
export type Place = (typeof PLACES)[number]

/** The action that goes to each place, so the sidebar can show its shortcut. */
export const SHOW: Record<Place, WindowActionId> = {
  spends: 'showSpends',
  accounts: 'showAccounts',
}

/** Where an undo or redo's change is, and what to select there; null if it changed nothing. */
export function shownBy(moved: Moved): { place: Place; id: string } | null {
  const [spend] = moved.spends
  if (spend !== undefined) return { place: 'spends', id: spend }
  const [account] = moved.accounts
  if (account !== undefined) return { place: 'accounts', id: account }
  return null
}
