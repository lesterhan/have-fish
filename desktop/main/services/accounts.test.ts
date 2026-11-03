import { describe, expect, test } from 'vitest'
import type { Changed } from '../../shared/commands'
import { contextFor, type Time } from '../context'
import { applyLocal } from '../ledger/apply'
import { anAccount, NOW, ok, tempLedger } from '../ledger/fixtures'
import { getDocument } from '../ledger/store'
import { undoItems } from '../undo/menu'
import { redoLast, undoLast } from '../undo/steps'
import { addAccount, listAccounts } from './accounts'
import { writeSpend } from './spends'

function setup() {
  const ledger = tempLedger()
  const announced: Changed[][] = []
  const clock: Time = { now: () => NOW, timeZone: () => 'UTC' }
  const ctx = contextFor(ledger, (changed) => announced.push(changed), clock)
  const stored = (id: string) => {
    const found = getDocument(ledger.db, 'account', id)
    if (found === null) throw new Error(`no account ${id}`)
    return found.doc
  }
  const names = () => listAccounts(ledger.db).map((a) => a.name)
  return { ledger, ctx, announced, stored, names }
}

const refusal = (outcome: { ok: boolean; failure?: unknown }) =>
  outcome.ok ? null : outcome.failure

describe('addAccount', () => {
  test('a card goes under liabilities, as I named it, locked to the currency I picked', () => {
    const { ctx, stored, announced } = setup()

    const { id } = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))

    expect(stored(id)).toEqual({
      type: 'account',
      id,
      path: 'liabilities:visa',
      kind: 'card',
      currency: 'CAD',
      deletedAt: null,
      origin: { source: 'manual', createdAt: NOW, deviceId: ctx.ledger.meta.deviceId },
    })
    expect(announced).toEqual([[{ type: 'account', id }]])
  })

  test('a loan is something I owe, like a card; a bank account is something I have', () => {
    const { ctx, stored } = setup()

    const loan = ok(addAccount(ctx, { name: 'car', kind: 'loan', currency: 'CAD' }))
    const bank = ok(addAccount(ctx, { name: 'chequing', kind: 'bank', currency: 'CAD' }))

    expect(stored(loan.id).path).toBe('liabilities:car')
    expect(stored(bank.id).path).toBe('assets:chequing')
  })

  test('with no currency it can hold any', () => {
    const { ctx, stored } = setup()

    const { id } = ok(addAccount(ctx, { name: 'wise', kind: 'bank', currency: null }))

    expect(stored(id).currency).toBeNull()
  })

  test('the name is trimmed, and a colon nests', () => {
    const { ctx, stored } = setup()

    const { id } = ok(addAccount(ctx, { name: '  wise:cad ', kind: 'bank', currency: 'CAD' }))

    expect(stored(id).path).toBe('assets:wise:cad')
  })

  test('a name that is empty, or only spaces, is refused', () => {
    const { ctx, names } = setup()

    for (const name of ['', '   ']) {
      expect(refusal(addAccount(ctx, { name, kind: 'bank', currency: 'CAD' }))).toEqual({
        code: 'ACCOUNT_NAME_EMPTY',
        details: undefined,
      })
    }
    expect(names()).toEqual([])
  })

  test('a name I already have is refused, whatever its case or kind', () => {
    const { ctx, names } = setup()
    ok(addAccount(ctx, { name: 'Visa', kind: 'card', currency: 'CAD' }))

    for (const kind of ['card', 'bank'] as const) {
      expect(refusal(addAccount(ctx, { name: 'visa ', kind, currency: 'CAD' }))).toEqual({
        code: 'ACCOUNT_NAME_TAKEN',
        details: { name: 'Visa' },
      })
    }
    expect(names()).toEqual(['Visa'])
  })

  test('the wallet a first spend made has its name, so a second cash is refused', () => {
    const { ctx } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))

    expect(refusal(addAccount(ctx, { name: 'cash', kind: 'cash', currency: null }))).toEqual({
      code: 'ACCOUNT_NAME_TAKEN',
      details: { name: 'cash' },
    })
  })

  test('the name of an account taken back is free again', () => {
    const { ctx, names } = setup()
    ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(undoLast(ctx))

    ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'USD' }))

    expect(names()).toEqual(['visa'])
  })

  test('a name with an empty part is refused by the ledger’s own check', () => {
    const { ctx } = setup()

    expect(refusal(addAccount(ctx, { name: 'wise::cad', kind: 'bank', currency: 'CAD' }))).toEqual({
      code: 'PATH_INVALID',
      details: { path: 'assets:wise::cad' },
    })
  })

  test('a currency have-fish doesn’t know is refused', () => {
    const { ctx } = setup()

    expect(refusal(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'XYZ' }))).toEqual({
      code: 'UNSUPPORTED_CURRENCY',
      details: { currency: 'XYZ' },
    })
  })
})

describe('listAccounts', () => {
  test('lists what I have and owe by name, without regard to case; never categories', () => {
    const { ctx, ledger } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    ok(addAccount(ctx, { name: 'Chequing', kind: 'bank', currency: 'CAD' }))
    ok(addAccount(ctx, { name: 'car', kind: 'loan', currency: null }))
    ok(applyLocal(ledger, [anAccount({ path: 'equity:opening', kind: 'opening' })], NOW))

    expect(listAccounts(ledger.db)).toEqual([
      { id: expect.any(String), name: 'car', kind: 'loan', currency: null },
      { id: expect.any(String), name: 'cash', kind: 'cash', currency: null },
      { id: expect.any(String), name: 'Chequing', kind: 'bank', currency: 'CAD' },
      { id: expect.any(String), name: 'visa', kind: 'card', currency: 'CAD' },
    ])
  })
})

describe('undoing an account added', () => {
  test('takes it back as one step named for it, and redo puts it back', () => {
    const { ctx, names, stored } = setup()
    const { id } = ok(addAccount(ctx, { name: 'visa', kind: 'card', currency: 'CAD' }))
    const typing = { undo: false, redo: false }

    expect(undoItems(ctx.history, typing).undo.label).toBe('Undo add account visa')
    expect(ok(undoLast(ctx))).toEqual({ spends: [], accounts: [id] })
    expect(names()).toEqual([])
    expect(stored(id).deletedAt).toBe(NOW)

    expect(undoItems(ctx.history, typing).redo.label).toBe('Redo add account visa')
    expect(ok(redoLast(ctx))).toEqual({ spends: [], accounts: [id] })
    expect(names()).toEqual(['visa'])
    expect(stored(id).deletedAt).toBeNull()
  })

  test('a refused add leaves nothing to undo', () => {
    const { ctx } = setup()

    addAccount(ctx, { name: '', kind: 'card', currency: 'CAD' })

    expect(ctx.history.nextUndo()).toBeUndefined()
  })
})
