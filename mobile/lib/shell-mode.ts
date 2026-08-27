/**
 * Shell mode — which of the two ledgers the Companion is currently showing.
 *
 * The app carries two unrelated ledgers: **Fish Pie** (shared group expenses,
 * settled between people) and **Cash** (the user's own wallets in the personal
 * ledger). Entering a spend in the wrong one is silently wrong — a personal cash
 * purchase logged as a group expense bills half of it to somebody else — so the
 * shell keeps them visibly apart rather than mixing their screens in one tab bar.
 *
 * Each mode owns its own header, its own tab set, and its own accent colour; the
 * Account tab is shared. Everything here is RN-free so `bun test` can cover it
 * without a renderer (Companion convention); the provider that persists the mode
 * lives in `shell-mode-context.tsx`.
 */
import { theme } from './theme'

export type ShellMode = 'pie' | 'cash'

/** Both modes, in tab-bar order. */
export const SHELL_MODES: readonly ShellMode[] = ['pie', 'cash']

/**
 * The mode a first launch opens in. Fish Pie is the app's original job and the
 * one every existing user has data for, so a fresh install lands where it always
 * did rather than on an empty Cash tab.
 */
export const DEFAULT_SHELL_MODE: ShellMode = 'pie'

/** AsyncStorage key for the last-used mode — the shell reopens where you left. */
export const SHELL_MODE_KEY = 'havefish_shell_mode'

export function isShellMode(value: unknown): value is ShellMode {
  return typeof value === 'string' && (SHELL_MODES as readonly string[]).includes(value)
}

/**
 * The mode to open on, given whatever was persisted. Anything unrecognised —
 * absent, corrupted, or written by a future version that knew a third mode —
 * degrades to the default rather than leaving the shell with no valid mode.
 */
export function resolveShellMode(stored: string | null | undefined): ShellMode {
  return isShellMode(stored) ? stored : DEFAULT_SHELL_MODE
}

/**
 * The mode to apply when the persisted read finally lands.
 *
 * The read is async and the switch is not: a user can tap Cash before storage
 * answers, and the late answer must not yank them back. `touched` records that
 * a deliberate choice has already been made, in which case the stored value is
 * discarded in favour of `current`.
 */
export function restoreShellMode(
  stored: string | null | undefined,
  touched: boolean,
  current: ShellMode,
): ShellMode {
  return touched ? current : resolveShellMode(stored)
}

/** The other mode — what the switch toggles to. */
export function otherMode(mode: ShellMode): ShellMode {
  return mode === 'pie' ? 'cash' : 'pie'
}

/** Label for a mode in the header switch. Short: the control is ~60px per side. */
export function modeLabel(mode: ShellMode): string {
  return mode === 'pie' ? 'Group' : 'Cash'
}

/**
 * `href` for a tab that belongs to `owner`, given the currently active mode.
 * `null` hides a tab from Expo Router's bar; `undefined` leaves the default
 * route href in place. One tab navigator holds every screen and the inactive
 * mode's tabs are hidden, which keeps each mode's state mounted across a switch
 * — cheaper and less jarring than tearing down a nested navigator.
 */
export function tabHref(owner: ShellMode, active: ShellMode): null | undefined {
  return owner === active ? undefined : null
}

/**
 * Where to land when switching into `mode`. A switch hides the tab you were
 * standing on, so the shell has to move somewhere valid; each mode's first tab
 * is its entry point (Add for Fish Pie, Spend for Cash).
 */
export function homeRouteFor(mode: ShellMode): '/(app)/' | '/(app)/cash-spend' {
  return mode === 'pie' ? '/(app)/' : '/(app)/cash-spend'
}

/** The accent tokens one mode paints its controls with. */
export interface ModeAccent {
  /** Solid accent — active tab tint, primary fills. */
  accent: string
  /** Pale fill behind a selected chip / segment. */
  soft: string
  /** Border of a selected chip / segment. */
  line: string
  /** Text colour on a `soft` fill. */
  ink: string
}

/**
 * Fish Pie keeps the app's rust accent; Cash gets the denim one. They are far
 * apart in hue on purpose — the accent is the peripheral cue that says which
 * ledger you are in before you read anything. Denim rather than a green also
 * keeps the mode cue from colliding with the green/red the amount colours use
 * for income and expense.
 */
export function accentFor(mode: ShellMode): ModeAccent {
  if (mode === 'cash') {
    return {
      accent: theme.color.cashAccent,
      soft: theme.color.cashAccentSoft,
      line: theme.color.cashAccentLine,
      ink: theme.color.cashAccentInk,
    }
  }
  return {
    accent: theme.color.accent,
    soft: theme.color.accentSoft,
    line: theme.color.accentLine,
    ink: theme.color.accentInk,
  }
}
