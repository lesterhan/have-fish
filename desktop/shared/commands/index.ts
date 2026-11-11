// What the window can ask main to do: each command's name, the input its schema takes, and the
// value it returns. Main implements them (`main/commands/`); the window imports only types.

import { z } from 'zod'
import type { StepName } from '../steps'
import { type AccountValues, accountInputs } from './accounts'
import { type PathValues, pathInputs } from './paths'
import { type ReportValues, reportInputs } from './reports'
import { type SettingsValues, settingsInputs } from './settings'
import { type SpendValues, spendInputs } from './spends'
import type { Changed, Typing, Wire } from './wire'

export * from './accounts'
export * from './paths'
export * from './reports'
export * from './settings'
export * from './spends'
export * from './wire'

export const inputs = {
  ...spendInputs,
  ...accountInputs,
  ...pathInputs,
  ...reportInputs,
  'ledger.undo': z.strictObject({}),
  'ledger.redo': z.strictObject({}),
  /** What Undo and Redo would take, by name; it changes nothing. */
  'ledger.steps': z.strictObject({}),
  ...settingsInputs,
  /** Text the window put together, onto the system clipboard. It writes nothing to the ledger. */
  'clipboard.copy': z.strictObject({ text: z.string().max(20_000) }),
}

/** What an undo or redo changed, so the window can select it: spends, or accounts. */
export type Moved = { spends: string[]; accounts: string[] }

export interface Values
  extends SpendValues,
    AccountValues,
    PathValues,
    ReportValues,
    SettingsValues {
  /** Both empty when there was nothing to undo. */
  'ledger.undo': Moved
  'ledger.redo': Moved
  'ledger.steps': { undo: StepName | null; redo: StepName | null }
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
