import { describe, expect, it } from 'vitest'
import { handlers as accounts } from '../features/accounts/commands'
import { handlers as clipboard } from '../features/clipboard/commands'
import { handlers as paths } from '../features/paths/commands'
import { handlers as reports } from '../features/reports/commands'
import { handlers as settings } from '../features/settings/commands'
import { handlers as spends } from '../features/spends/commands'
import { handlers as undo } from '../undo/commands'
import { handlers } from './registry'

/** Each feature's handler map, and undo's. */
const EACH: Record<string, unknown>[] = [
  spends,
  accounts,
  paths,
  reports,
  undo,
  settings,
  clipboard,
]

describe('the registry', () => {
  it("gives each command the very handler one feature's or undo's map holds under its name", () => {
    for (const [name, handler] of Object.entries(handlers)) {
      const held = EACH.filter((each) => Object.hasOwn(each, name)).map((each) => each[name])
      expect(held).toHaveLength(1)
      expect(held[0]).toBe(handler)
    }
  })
})
