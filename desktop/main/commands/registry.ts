// Each command the window can run, by name. The names and input schemas are in
// `shared/commands.ts`; this maps each to the service that does it.

import { handlers as accounts } from '../features/accounts/commands'
import { handlers as spends } from '../features/spends/commands'
import { listPaths } from '../services/paths'
import { spendingIn } from '../services/reports'
import { getDensity, setDensity, setTheme } from '../services/settings'
import { nextSteps, redoLast, undoLast } from '../undo/steps'
import type { Handlers } from './handlers'

export const handlers: Handlers = {
  ...spends,
  ...accounts,
  'path.list': (ctx) => ({ ok: true, value: listPaths(ctx.ledger.db) }),
  'report.spending': (ctx, input) => spendingIn(ctx.ledger.db, input),
  'ledger.undo': undoLast,
  'ledger.redo': redoLast,
  'ledger.steps': (ctx) => ({ ok: true, value: nextSteps(ctx) }),
  'settings.theme.set': setTheme,
  'settings.density.get': getDensity,
  'settings.density.set': setDensity,
  'clipboard.copy': (ctx, { text }) => {
    ctx.copy(text)
    return { ok: true, value: null }
  },
}
