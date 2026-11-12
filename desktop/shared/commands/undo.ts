// What undo and redo ask of main: they take back or put back a step of the ledger.

import { z } from 'zod'
import type { StepName } from '../steps'

export const undoInputs = {
  'ledger.undo': z.strictObject({}),
  'ledger.redo': z.strictObject({}),
  /** What Undo and Redo would take, by name; it changes nothing. */
  'ledger.steps': z.strictObject({}),
}

/** What an undo or redo changed, so the window can select it: spends, or accounts. */
export type Moved = { spends: string[]; accounts: string[] }

export interface UndoValues {
  /** Both empty when there was nothing to undo. */
  'ledger.undo': Moved
  'ledger.redo': Moved
  'ledger.steps': { undo: StepName | null; redo: StepName | null }
}
