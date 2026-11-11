// What the window can ask main to do: each command's name, the input its schema takes, and the
// value it returns. Main implements them (`main/commands/`); the window imports only types.

import type { z } from 'zod'
import { type AccountValues, accountInputs } from './accounts'
import { type ClipboardValues, clipboardInputs } from './clipboard'
import { type PathValues, pathInputs } from './paths'
import { type ReportValues, reportInputs } from './reports'
import { type SettingsValues, settingsInputs } from './settings'
import { type SpendValues, spendInputs } from './spends'
import { type UndoValues, undoInputs } from './undo'
import type { Changed, Typing, Wire } from './wire'

export * from './accounts'
export * from './clipboard'
export * from './paths'
export * from './reports'
export * from './settings'
export * from './spends'
export * from './undo'
export * from './wire'

export const inputs = {
  ...spendInputs,
  ...accountInputs,
  ...pathInputs,
  ...reportInputs,
  ...undoInputs,
  ...settingsInputs,
  ...clipboardInputs,
}

export interface Values
  extends SpendValues,
    AccountValues,
    PathValues,
    ReportValues,
    UndoValues,
    SettingsValues,
    ClipboardValues {}

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
