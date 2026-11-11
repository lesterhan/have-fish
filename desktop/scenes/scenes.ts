// The scenes: each names one state of the window — a fixture, a density, and the steps that get
// there. The eight to start: the ledger empty, on the starter accounts, a year in, a year in at
// Compact, and with a spend open; Accounts a year in; Reports a year in, and with a category open.

import type { WindowActionId } from '../shared/actions'
import type { Density } from '../shared/density'

/**
 * One move in a scene: an action as the menu would send it, a key on whatever has the cursor,
 * or a click on the first element a CSS selector finds.
 */
export type Step = { action: WindowActionId } | { key: string } | { click: string }

export type Scene = {
  /** `<place>/<state>`. */
  name: string
  fixture: 'empty' | 'starter' | 'year'
  density?: Density
  steps: readonly Step[]
}

export const SCENES: readonly Scene[] = [
  { name: 'ledger/empty', fixture: 'empty', steps: [] },
  { name: 'ledger/starter', fixture: 'starter', steps: [] },
  { name: 'ledger/year', fixture: 'year', steps: [] },
  { name: 'ledger/compact', fixture: 'year', density: 'compact', steps: [] },
  { name: 'ledger/spend-open', fixture: 'year', steps: [{ key: 'Enter' }] },
  { name: 'accounts/year', fixture: 'year', steps: [{ action: 'showAccounts' }] },
  { name: 'reports/year', fixture: 'year', steps: [{ action: 'showReports' }] },
  {
    name: 'reports/category-open',
    fixture: 'year',
    // One click picks the first row that opens; the second opens it.
    steps: [
      { action: 'showReports' },
      { click: '[role=treeitem][aria-expanded]' },
      { click: '[role=treeitem][aria-expanded]' },
    ],
  },
]

/** The scene called `name`; null for none, or for one that isn't. */
export function sceneNamed(name: string | null): Scene | null {
  return SCENES.find((scene) => scene.name === name) ?? null
}
