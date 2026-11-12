import { DOCUMENT_TYPES, type DocumentTypeName } from '@have-fish/core/documents'
import { WALLET } from '@have-fish/core/own-accounts'
import { describe, expect, test } from 'vitest'
import { type Changed, type CommandName, type InputOf, inputs } from '../../shared/commands'
import { traits } from '../../shared/traits'
import { contextFor } from '../context'
import { applyLocal } from '../ledger/apply'
import { anAccount, aSpend, NOW, ok, tempLedger } from '../ledger/fixtures'
import { type Log, runCommand } from './run'

/** An input for each command whose `reads` leaves a kind out, and for no other. */
const SAMPLES: { [N in CommandName]?: InputOf<N> } = {
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

/** A ledger with the wallet, a card, a category and one spend from the wallet to it. */
function setup() {
  const ledger = tempLedger()
  const wallet = anAccount({ path: WALLET.path, kind: WALLET.kind })
  const card = anAccount({ path: 'liabilities:visa', kind: 'card' })
  const category = anAccount({ path: 'expenses:food', kind: 'category' })
  ok(applyLocal(ledger, [wallet, card, category, aSpend(wallet.id, category.id)], NOW))
  const announced: Changed[][] = []
  const ctx = contextFor({ ledger, announce: (changed) => announced.push(changed) })
  return { ctx, wallet, card, announced }
}

/** A spend from the card: a transaction, and nothing else. */
const fromCard = (cardId: string) => ({
  amount: '5.00',
  description: 'Coffee',
  from: cardId,
  to: { category: 'food' },
})

describe("a command's reads", () => {
  test.each(CASES)('%s answers the same after a new %s', (command, kind) => {
    const { ctx, card, announced } = setup()
    const sample = SAMPLES[command]
    const before = runCommand(ctx, command, sample, log)
    expect(before.ok).toBe(true)

    const change =
      kind === 'transaction'
        ? runCommand(ctx, 'spend.write', fromCard(card.id), log)
        : runCommand(ctx, 'account.add', { name: 'Savings', kind: 'bank', currency: null }, log)
    expect(change.ok).toBe(true)
    expect(announced.flat().map((changed) => changed.type)).toEqual([kind])

    expect(runCommand(ctx, command, sample, log)).toEqual(before)
  })

  test('a spend from the card moves spend.assumedFrom from the wallet to the card', () => {
    const { ctx, wallet, card } = setup()
    expect(runCommand(ctx, 'spend.assumedFrom', {}, log)).toEqual({
      ok: true,
      value: { id: wallet.id },
    })
    runCommand(ctx, 'spend.write', fromCard(card.id), log)
    expect(runCommand(ctx, 'spend.assumedFrom', {}, log)).toEqual({
      ok: true,
      value: { id: card.id },
    })
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
