// Each command the window can run, by name. The names and input schemas are in
// `shared/commands.ts`; this maps each to the service that does it.

import { handlers as accounts } from '../features/accounts/commands'
import { handlers as clipboard } from '../features/clipboard/commands'
import { handlers as paths } from '../features/paths/commands'
import { handlers as reports } from '../features/reports/commands'
import { handlers as settings } from '../features/settings/commands'
import { handlers as spends } from '../features/spends/commands'
import { handlers as undo } from '../undo/commands'
import type { Handlers } from './handlers'

export const handlers: Handlers = {
  ...spends,
  ...accounts,
  ...paths,
  ...reports,
  ...undo,
  ...settings,
  ...clipboard,
}
