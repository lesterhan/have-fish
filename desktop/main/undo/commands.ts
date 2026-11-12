// Undo's commands, which every feature's steps go through, so they stay in the core.

import type { undoInputs } from '../../shared/commands'
import type { HandlersFor } from '../commands/handlers'
import { nextSteps, redoLast, undoLast } from './steps'

export const handlers: HandlersFor<keyof typeof undoInputs> = {
  'ledger.undo': undoLast,
  'ledger.redo': redoLast,
  'ledger.steps': (ctx) => ({ ok: true, value: nextSteps(ctx) }),
}
