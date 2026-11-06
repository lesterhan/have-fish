import { describe, expect, test, vi } from 'vitest'
import { runAction } from './actions'

describe('runAction', () => {
  const handlers = () => ({
    newSpend: vi.fn(),
    saveAll: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    remove: vi.fn(),
    showLedger: vi.fn(),
    showAccounts: vi.fn(),
    showReports: vi.fn(),
    addAccount: vi.fn(),
    themeGraphiteLight: vi.fn(),
    themeGraphiteDark: vi.fn(),
    themeSystem: vi.fn(),
  })

  test("runs the action's handler", () => {
    const h = handlers()
    runAction('newSpend', h)
    expect(h.newSpend).toHaveBeenCalledOnce()
    expect(h.saveAll).not.toHaveBeenCalled()
  })

  test('ignores an id it does not know', () => {
    const h = handlers()
    for (const id of ['', 'reload', 'toString', '__proto__', 'copy']) runAction(id, h)
    expect(h.newSpend).not.toHaveBeenCalled()
    expect(h.saveAll).not.toHaveBeenCalled()
  })
})
