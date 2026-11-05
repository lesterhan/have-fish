import { describe, expect, test } from 'vitest'
import type { ThemeChoice } from '../../shared/theme/theme'
import { runCommand } from '../commands/run'
import { contextFor } from '../context'
import { NOW, tempLedger } from '../ledger/fixtures'
import { forgetful } from '../machine'

function setup() {
  const shown: ThemeChoice[] = []
  const announced: unknown[] = []
  const machine = forgetful()
  const ledger = tempLedger()
  const clock = { now: () => NOW, timeZone: () => 'UTC' }
  const ctx = contextFor(
    ledger,
    (c) => announced.push(c),
    clock,
    machine,
    (t) => shown.push(t),
  )
  const log = { info: () => {}, error: () => {} }
  return { ctx, ledger, machine, shown, announced, log }
}

describe('settings.theme.set', () => {
  test('remembers the theme on this machine and repaints the window', () => {
    const { ctx, machine, shown, log } = setup()
    expect(runCommand(ctx, 'settings.theme.set', { theme: 'graphite-dark' }, log)).toEqual({
      ok: true,
      value: { theme: 'graphite-dark' },
    })
    expect([machine.theme(), shown]).toEqual(['graphite-dark', ['graphite-dark']])
  })

  test('touches nothing in the ledger, and is not a step to undo', () => {
    const { ctx, ledger, announced, log } = setup()
    const versions = () => ledger.db.prepare('SELECT count(*) AS n FROM outbox').get()
    const before = versions()
    runCommand(ctx, 'settings.theme.set', { theme: 'graphite-light' }, log)
    expect([versions(), announced, ctx.history.nextUndo()]).toEqual([before, [], undefined])
  })

  test.each([{ theme: 'solarized' }, { theme: 'dark' }, {}, { theme: 'system', more: 1 }])(
    'refuses %j',
    (input) => {
      const { ctx, shown, log } = setup()
      expect(runCommand(ctx, 'settings.theme.set', input, log)).toMatchObject({
        ok: false,
        error: 'INPUT_MALFORMED',
      })
      expect(shown).toEqual([])
    },
  )
})
