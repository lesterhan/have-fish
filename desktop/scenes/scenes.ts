// The scenes: each names one state of the window — a fixture, a density, and the steps that get
// there. The eight to start: the ledger empty, on the starter accounts, a year in, a year in at
// Compact, and with a spend open; Accounts a year in; Reports a year in, and with a category
// open. Then the six design argues about: the palette, a path picker, a refused write, a chip
// being changed, the account pane adding, and a line half written.

import { PLACES, type Place } from '../renderer/shell/places'
import type { WindowActionId } from '../shared/actions'
import type { Density } from '../shared/density'

/**
 * One move in a scene: an action as the menu would send it, a key on whatever has the cursor,
 * a click on the first element a CSS selector finds, or text typed into the first field one
 * finds.
 */
export type Step =
  | { action: WindowActionId }
  | { key: string }
  | { click: string }
  | { fill: string; text: string }

export type Scene = {
  /** `<place>/<state>`. */
  name: string
  /** What it shows, for the index. */
  about: string
  fixture: 'empty' | 'starter' | 'year'
  density?: Density
  steps: readonly Step[]
}

/** The line that writes a spend, as a step's selector finds it. */
export const COMPOSER = 'form[aria-label="Write down a spend"]'

export const SCENES: readonly Scene[] = [
  {
    name: 'ledger/empty',
    about: 'First run: the composer line open on nothing',
    fixture: 'empty',
    steps: [],
  },
  {
    name: 'ledger/starter',
    about: "The starter accounts' opening balances",
    fixture: 'starter',
    steps: [],
  },
  {
    name: 'ledger/year',
    about: 'A year of spends, the window as it mostly looks',
    fixture: 'year',
    steps: [],
  },
  {
    name: 'ledger/compact',
    about: 'The year at Compact density',
    fixture: 'year',
    density: 'compact',
    steps: [],
  },
  {
    name: 'ledger/spend-open',
    about: "A spend's details open, Enter on the first row",
    fixture: 'year',
    steps: [{ key: 'Enter' }],
  },
  {
    name: 'ledger/palette',
    about: 'The action palette open',
    fixture: 'year',
    steps: [{ action: 'palette' }],
  },
  {
    name: 'ledger/path-picker',
    about: "The composer's From picker open, emptied",
    fixture: 'year',
    // Emptied and a key down: the field opens the list of every account and income source.
    steps: [
      { action: 'newSpend' },
      { fill: `${COMPOSER} input[name=from]`, text: '' },
      { key: 'ArrowDown' },
    ],
  },
  {
    name: 'ledger/refused',
    about: "A spend written and refused: the line says it wasn't saved",
    fixture: 'year',
    // The stand-in bridge can't write, so the line says it wasn't saved.
    steps: [
      { action: 'newSpend' },
      { fill: `${COMPOSER} input[name=amount]`, text: '12.50' },
      { fill: `${COMPOSER} input[name=description]`, text: 'Lunch' },
      { key: 'Enter' },
    ],
  },
  {
    name: 'ledger/chip-changing',
    about: 'A spend open, its amount being changed',
    fixture: 'year',
    steps: [{ key: 'Enter' }, { click: 'button[aria-label=Amount]' }],
  },
  {
    name: 'ledger/composer-typing',
    about: 'A line half written: 12.50, Lunch',
    fixture: 'year',
    steps: [
      { action: 'newSpend' },
      { fill: `${COMPOSER} input[name=amount]`, text: '12.50' },
      { fill: `${COMPOSER} input[name=description]`, text: 'Lunch' },
    ],
  },
  {
    name: 'accounts/year',
    about: 'Accounts, a year in',
    fixture: 'year',
    steps: [{ action: 'showAccounts' }],
  },
  {
    name: 'accounts/adding',
    about: 'The account pane open on a new account',
    fixture: 'year',
    steps: [{ action: 'showAccounts' }, { action: 'addAccount' }],
  },
  {
    name: 'reports/year',
    about: "Reports on the fixture's last week",
    fixture: 'year',
    steps: [{ action: 'showReports' }],
  },
  {
    name: 'reports/category-open',
    about: 'A category open, its spends beside',
    fixture: 'year',
    // One click picks the first row that opens; the second opens it.
    steps: [
      { action: 'showReports' },
      { click: '[role=treeitem][aria-expanded]' },
      { click: '[role=treeitem][aria-expanded]' },
    ],
  },
]

/** The scenes by place, in the app's order of places and each in SCENES' order. */
export function scenesByPlace(): { place: Place; scenes: Scene[] }[] {
  return PLACES.map((place) => ({
    place,
    scenes: SCENES.filter((scene) => scene.name.startsWith(`${place}/`)),
  }))
}

/** The scene called `name`; null for none, or for one that isn't. */
export function sceneNamed(name: string | null): Scene | null {
  return SCENES.find((scene) => scene.name === name) ?? null
}
