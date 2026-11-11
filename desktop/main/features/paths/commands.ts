// The path picker's command: every account and category it can offer.

import type { pathInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { listPaths } from './paths'

export const handlers: HandlersFor<keyof typeof pathInputs> = {
  'path.list': (ctx) => ({ ok: true, value: listPaths(ctx.ledger.db) }),
}
