// What the window can ask main to do: each command's name, the input its schema takes, and the
// value it returns. Main implements them (`main/commands/`); the window imports only types.

import { type AccountKind, ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
import { z } from 'zod'
import { DENSITIES, type Density } from '../density'
import type { StepName } from '../steps'
import { THEME_CHOICES, type ThemeChoice } from '../theme/theme'
import { type SpendValues, spendInputs } from './spends'
import { type Changed, date, type Money, type Typing, typed, type Wire } from './wire'

export * from './spends'
export * from './wire'

export const inputs = {
  ...spendInputs,
  /** `currency` null: it can hold any. */
  'account.add': z.strictObject({
    name: typed(200),
    kind: z.enum(ADDABLE_KINDS),
    currency: typed(8).nullable(),
    /** How much is in it today, or owed on it, as typed; empty for nothing. */
    start: typed(64).default(''),
  }),
  /** A starting balance for an account that has none. */
  'account.start': z.strictObject({ id: z.uuid(), amount: typed(64) }),
  'account.list': z.strictObject({}),
  /** Every account and category, for a path picker: its whole path, kind and last use. */
  'path.list': z.strictObject({}),
  /** What went to each category from `start` to `end`, both days in it. */
  'report.spending': z.strictObject({ start: date, end: date }),
  'ledger.undo': z.strictObject({}),
  'ledger.redo': z.strictObject({}),
  /** What Undo and Redo would take, by name; it changes nothing. */
  'ledger.steps': z.strictObject({}),
  /** This machine's theme: never the ledger's. */
  'settings.theme.set': z.strictObject({ theme: z.enum(THEME_CHOICES) }),
  /** How tightly this machine sets the ledger: never the ledger's. */
  'settings.density.get': z.strictObject({}),
  'settings.density.set': z.strictObject({ density: z.enum(DENSITIES) }),
  /** Text the window put together, onto the system clipboard. It writes nothing to the ledger. */
  'clipboard.copy': z.strictObject({ text: z.string().max(20_000) }),
}

/** An account or category as a path picker offers it. */
export type ListedPath = {
  id: string
  /** Its whole path, root and all: `expenses:food:coffee`. */
  path: string
  kind: AccountKind
  /** UTC ms of the latest live transaction that used it; null if none has. */
  lastUsed: number | null
}

/** An account I added, as the Accounts list shows it. */
export type ListedAccount = {
  id: string
  /** Its path without the root: `visa`, `wise:cad`. */
  name: string
  kind: AddableKind
  /** The one currency it holds, or null for any. */
  currency: string | null
  /** What was in it, or owed on it, the day it started; null if it was never said. */
  start: (Money & { date: string }) | null
  /**
   * What its own postings sum to in each currency, by code, as the ledger holds it: what I owe is
   * below zero. None that sum to zero; empty for nothing in it.
   */
  balance: Money[]
}

/** One spend's money in one category, as a report sums it. */
export type ReportedSpend = {
  /** The transaction's id. */
  id: string
  /** Its name without the root (`food:coffee`); `''` for unsorted. */
  category: string
  amount: string
}

/** What an undo or redo changed, so the window can select it: spends, or accounts. */
export type Moved = { spends: string[]; accounts: string[] }

export interface Values extends SpendValues {
  'account.add': { id: string }
  /** The starting balance's transaction; null when there was nothing to write (empty, or zero). */
  'account.start': { id: string | null }
  /** Sorted by name, without regard to case. */
  'account.list': ListedAccount[]
  /** Every live account and category, by path. */
  'path.list': ListedPath[]
  /**
   * In the home currency, `currency`, oldest day first. `other` is what went to categories in
   * each other currency, by code: none that sum to zero.
   */
  'report.spending': { currency: string; spent: ReportedSpend[]; other: Money[] }
  /** Both empty when there was nothing to undo. */
  'ledger.undo': Moved
  'ledger.redo': Moved
  'ledger.steps': { undo: StepName | null; redo: StepName | null }
  'settings.theme.set': { theme: ThemeChoice }
  'settings.density.get': { density: Density }
  'settings.density.set': { density: Density }
  'clipboard.copy': null
}

export type CommandName = keyof typeof inputs
export type InputOf<N extends CommandName> = z.input<(typeof inputs)[N]>

/** What the preload puts on `window.haveFish`. */
export type Bridge = {
  invoke<N extends CommandName>(name: N, input: InputOf<N>): Promise<Wire<Values[N]>>
  /** Calls `listener` after each command that wrote anything. Returns the unsubscribe. */
  onChanged(listener: (changed: Changed[]) => void): () => void
  /** Calls `listener` with an action's id when it is chosen from the menu. Returns the unsubscribe. */
  onAction(listener: (id: string) => void): () => void
  /** Tells main where Undo and Redo would go now, so the menu can name it. */
  setTyping(typing: Typing): void
}
