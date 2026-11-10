// The words for the menu: its menus, each action in `shared/actions.ts`, and the keys a hint
// names.

import type { ActionId } from '../shared/actions'

/** Every action has words, so a new one fails `bun run check` until it's given some. */
const labels: { [A in ActionId]: string } = {
  newSpend: 'New spend',
  addAccount: 'Add account',
  quit: 'Quit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  remove: 'Remove spend',
  postings: 'Show or hide postings',
  refile: 'Refile spend',
  palette: 'Do anything…',
  showLedger: 'Ledger',
  showAccounts: 'Accounts',
  showReports: 'Reports',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Actual size',
  densityCompact: 'Compact',
  densityRegular: 'Regular',
  densityComfortable: 'Comfortable',
  densityLarge: 'Large',
  themeGraphiteLight: 'Graphite light',
  themeGraphiteDark: 'Graphite dark',
  themeSystem: 'Follow the system',
}

export const actions = {
  /** `&` marks the letter that opens the menu with Alt, on Linux and Windows. */
  menus: { file: '&File', edit: '&Edit', view: '&View', density: '&Density', theme: '&Theme' },
  labels,
  /** Undo and Redo while the focused field has typing of yours to take back or put back. */
  typing: { undo: 'Undo typing', redo: 'Redo typing' },
  /** The modifier keys as a hint spells them off macOS, which uses symbols. */
  keys: { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' },
}
