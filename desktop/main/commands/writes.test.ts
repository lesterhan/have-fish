import { describe, expect, test, vi } from 'vitest'
import type { Changed } from '../../shared/commands'
import { contextFor } from '../context'
import { NOW, tempLedger } from '../ledger/fixtures'
import { type Log, runCommand } from './run'

// No command's entry is false, so this one is made to say it writes nothing.
vi.mock('../../shared/traits', async (original) => {
  const actual = await original<typeof import('../../shared/traits')>()
  return {
    ...actual,
    traits: { ...actual.traits, 'spend.write': { ...actual.traits['spend.write'], writes: false } },
  }
})

function setup() {
  const announced: Changed[][] = []
  const ctx = contextFor({
    ledger: tempLedger(),
    announce: (changed) => announced.push(changed),
    time: { now: () => NOW, timeZone: () => 'UTC' },
  })
  const lines: string[] = []
  const errors: unknown[] = []
  const log: Log = { info: (line) => lines.push(line), error: (_, e) => errors.push(e) }
  return { ctx, log, lines, errors, announced }
}

describe('runCommand', () => {
  test('refuses a command that says it writes nothing if it applies, leaving the ledger', () => {
    const { ctx, log, lines, errors, announced } = setup()
    expect(runCommand(ctx, 'spend.write', { amount: '12.50', description: 'Lunch' }, log)).toEqual({
      ok: false,
      error: 'UNEXPECTED',
    })

    const page = runCommand(ctx, 'transaction.page', { from: 0, limit: 100 }, log)
    expect(page.ok && page.value.total).toBe(0)
    expect(runCommand(ctx, 'account.list', {}, log)).toEqual({ ok: true, value: [] })
    expect(announced).toEqual([])
    expect(errors).toEqual([new Error('spend.write says it writes nothing')])
    expect(lines[0]).toMatch(/ UNEXPECTED$/)
  })

  test('lets a command that says it writes, write', () => {
    const { ctx, log } = setup()
    const added = { name: 'savings', kind: 'bank', currency: null }
    expect(runCommand(ctx, 'account.add', added, log)).toMatchObject({ ok: true })
    expect(runCommand(ctx, 'account.list', {}, log)).toMatchObject({
      ok: true,
      value: [{ name: 'savings', kind: 'bank' }],
    })
  })

  test('answers as before for a command that says it writes nothing and never applies', () => {
    const { ctx, log } = setup()
    expect(runCommand(ctx, 'settings.density.set', { density: 'large' }, log)).toEqual({
      ok: true,
      value: { density: 'large' },
    })
  })
})
