import { describe, expect, it } from 'vitest'
import { accountInputs } from './accounts'
import { clipboardInputs } from './clipboard'
import { inputs } from './index'
import { pathInputs } from './paths'
import { reportInputs } from './reports'
import { settingsInputs } from './settings'
import { spendInputs } from './spends'
import { undoInputs } from './undo'

describe('the commands, assembled', () => {
  it("hold each command once: a spread keeps the last of two silently, so none is in two features' files", () => {
    const each = [
      spendInputs,
      accountInputs,
      pathInputs,
      reportInputs,
      undoInputs,
      settingsInputs,
      clipboardInputs,
    ]
    const sum = each.reduce((n, i) => n + Object.keys(i).length, 0)
    expect(Object.keys(inputs)).toHaveLength(sum)
  })
})
