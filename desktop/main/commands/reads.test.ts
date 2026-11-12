import { DOCUMENT_TYPES, type DocumentTypeName } from '@have-fish/core/documents'
import { WALLET } from '@have-fish/core/own-accounts'
import { describe, expect, test } from 'vitest'
import { type CommandName, type InputOf, inputs } from '../../shared/commands'
import { traits } from '../../shared/traits'
import { contextFor } from '../context'
import { applyLocal } from '../ledger/apply'
import { anAccount, aSpend, NOW, ok, tempLedger } from '../ledger/fixtures'
import { type Log, runCommand } from './run'

/** An input for each command whose `reads` leaves a kind out, and for no other. */
const SAMPLES: { [N in CommandName]?: InputOf<N> } = {
  'spend.assumedFrom': {},
  'settings.theme.set': { theme: 'system' },
  'settings.density.get': {},
  'settings.density.set': { density: 'large' },
  'clipboard.copy': { text: 'Groceries 12.50' },
}

const KINDS = Object.keys(DOCUMENT_TYPES) as DocumentTypeName[]
const COMMANDS = Object.keys(inputs) as CommandName[]

const leftOut = (command: CommandName) =>
  KINDS.filter((kind) => !traits[command].reads.includes(kind))

const CASES = COMMANDS.flatMap((command) =>
  leftOut(command).map((kind) => [command, kind] as const),
)

const log: Log = { info: () => {}, error: () => {} }

describe("a command's reads", () => {
  test.each(CASES)('%s answers the same after a new %s', (command, kind) => {
    const ledger = tempLedger()
    const wallet = anAccount({ path: WALLET.path, kind: WALLET.kind })
    const category = anAccount({ path: 'expenses:food', kind: 'category' })
    ok(applyLocal(ledger, [wallet, category, aSpend(wallet.id, category.id)], NOW))
    const ctx = contextFor({ ledger, announce: () => {} })
    const sample = SAMPLES[command]

    const before = runCommand(ctx, command, sample, log)
    const change =
      kind === 'transaction'
        ? aSpend(wallet.id, category.id)
        : anAccount({ path: 'assets:savings', kind: 'bank' })
    ok(applyLocal(ledger, [change], NOW))

    expect(runCommand(ctx, command, sample, log)).toEqual(before)
  })

  test('every command whose reads leaves a kind out has a sample', () => {
    const missing = COMMANDS.filter((c) => leftOut(c).length > 0 && !Object.hasOwn(SAMPLES, c))
    expect(missing).toEqual([])
  })

  test('every command with a sample leaves a kind out, so no sample outlives its need', () => {
    const needless = COMMANDS.filter((c) => Object.hasOwn(SAMPLES, c) && leftOut(c).length === 0)
    expect(needless).toEqual([])
  })
})
