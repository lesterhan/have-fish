// Where the cursor goes in the ledger after something it did, without a DOM. `Spends.svelte` asks
// here at each of these moments and puts the cursor where it's told; the keys a person presses
// move it themselves.

/** The line that writes a spend (opened if it isn't), the list, or the open spend's card. */
export type Cursor = 'line' | 'list' | 'card'

export type CursorMoment =
  | 'loaded'
  | 'cameHere'
  | 'newSpend'
  | 'written'
  | 'lineClosed'
  | 'removed'
  | 'cardOpened'
  | 'cardClosed'

export type CursorState = {
  /** How many rows the ledger has, as it is now. */
  total: number
  /** The line is open. */
  composing: boolean
  /** Another place shows: the ledger's fields can't take the cursor. */
  hidden: boolean
  /** The removed spend's card was open. */
  cardWasOpen: boolean
}

/** Where the cursor goes; null leaves it where it is. */
export function cursorFor(moment: CursorMoment, state: CursorState): Cursor | null {
  switch (moment) {
    case 'loaded':
      if (state.hidden) return null
      // The first run's line is already open when the ledger comes in: it takes the cursor.
      return state.composing || state.total === 0 ? 'line' : 'list'
    case 'cameHere':
      return state.composing || state.total === 0 ? 'line' : 'list'
    case 'newSpend':
      return 'line'
    case 'written':
      // A line opened while the ledger caught up isn't done with the cursor.
      return state.composing ? null : 'list'
    case 'lineClosed':
      return state.total === 0 ? null : 'list'
    case 'removed':
      if (state.total === 0) return 'line'
      return state.cardWasOpen ? 'list' : null
    case 'cardOpened':
      return 'card'
    case 'cardClosed':
      return 'list'
  }
}
