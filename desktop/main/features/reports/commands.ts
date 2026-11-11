// The reports' command: what went to each category over some days.

import type { reportInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { spendingIn } from './reports'

export const handlers: HandlersFor<keyof typeof reportInputs> = {
  'report.spending': (ctx, input) => spendingIn(ctx.ledger.db, input),
}
