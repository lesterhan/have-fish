import { describe, expect, it } from 'vitest'
import { accountInputs } from './accounts'
import { clipboardInputs } from './clipboard'
import { inputs } from './index'
import { pathInputs } from './paths'
import { reportInputs } from './reports'
import { settingsInputs } from './settings'
import { spendInputs } from './spends'
import { undoInputs } from './undo'

/** Each feature's inputs, and undo's. */
const EACH: Record<string, unknown>[] = [
  spendInputs,
  accountInputs,
  pathInputs,
  reportInputs,
  undoInputs,
  settingsInputs,
  clipboardInputs,
]

describe('the commands, assembled', () => {
  it("hold each command once: a spread keeps the last of two silently, so none is in two features' files", () => {
    const sum = EACH.reduce((n, i) => n + Object.keys(i).length, 0)
    expect(Object.keys(inputs)).toHaveLength(sum)
  })

  it("give each command the very schema one feature's or undo's inputs hold under its name", () => {
    for (const [name, schema] of Object.entries(inputs)) {
      const held = EACH.filter((each) => Object.hasOwn(each, name)).map((each) => each[name])
      expect(held).toHaveLength(1)
      expect(held[0]).toBe(schema)
    }
  })
})
