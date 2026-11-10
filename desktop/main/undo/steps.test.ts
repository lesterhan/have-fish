import type { TransactionDoc } from '@have-fish/core/documents'
import { formatVersion, type Version } from '@have-fish/core/version'
import { describe, expect, test } from 'vitest'
import { contextFor, type Time } from '../context'
import { applyReceived } from '../ledger/apply'
import { ok, tempLedger } from '../ledger/fixtures'
import { queued } from '../ledger/outbox'
import { getDocument } from '../ledger/store'
import { editSpend, removeSpend, writeSpend } from '../services/spends'
import { listTransactions } from '../services/transactions'
import { nextSteps, redoLast, undoLast } from './steps'

const START = Date.UTC(2026, 9, 29, 12)

function setup() {
  const ledger = tempLedger()
  const clock: Time & { at: number } = {
    at: START,
    now: () => clock.at,
    timeZone: () => 'UTC',
  }
  const ctx = contextFor({ ledger, announce: () => {}, time: clock })
  /** A second later each time, as a person types. */
  const later = () => {
    clock.at += 1000
  }
  const stored = (id: string) => {
    const found = getDocument(ledger.db, 'transaction', id)
    if (found === null) throw new Error(`no transaction ${id}`)
    return found
  }
  const listed = () => listTransactions(ledger.db).map((t) => t.description)
  return { ledger, ctx, clock, later, stored, listed }
}

const newer = (a: Version, b: Version) => formatVersion(a) > formatVersion(b)

/** Another device's change to a spend, a moment after `now`. */
function fromThePhone(ledger: ReturnType<typeof tempLedger>, doc: TransactionDoc, now: number) {
  const version = { wallMs: now, counter: 0, deviceId: 'f0e1d2c3b4a59687' }
  applyReceived(ledger, [{ doc: { ...doc, description: 'From the phone' }, version }], now)
}

describe('undo and redo', () => {
  test('undoing a write leaves a tombstone, and redo brings the spend back exactly', () => {
    const { ctx, later, stored, listed } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const written = stored(id)

    later()
    expect(ok(undoLast(ctx))).toEqual({ spends: [id], accounts: [] })
    const undone = stored(id)
    expect(undone.doc.deletedAt).not.toBeNull()
    expect(undone.doc.postings).toEqual([])
    expect(listed()).toEqual([])

    later()
    expect(ok(redoLast(ctx))).toEqual({ spends: [id], accounts: [] })
    const redone = stored(id)
    expect(redone.doc).toEqual(written.doc)
    expect(newer(redone.version, undone.version)).toBe(true)
    expect(listed()).toEqual(['Coffee'])
  })

  test('undoing a write keeps the accounts the spend made', () => {
    const { ledger, ctx, later } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(undoLast(ctx))
    const live = ledger.db.prepare('SELECT path FROM accounts WHERE deletedAt IS NULL').pluck()
    expect(live.all().sort()).toEqual(['assets:cash', 'expenses:unsorted'])
  })

  test('undoing a removal brings the spend back exactly as it was; redo removes it again', () => {
    const { ctx, later, stored, listed } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const was = stored(id)
    later()
    ok(removeSpend(ctx, { id }))
    expect(listed()).toEqual([])

    later()
    expect(ok(undoLast(ctx))).toEqual({ spends: [id], accounts: [] })
    expect(stored(id).doc).toEqual(was.doc)
    expect(newer(stored(id).version, was.version)).toBe(true)
    expect(listed()).toEqual(['Coffee'])

    later()
    ok(redoLast(ctx))
    expect(listed()).toEqual([])
  })

  test('undoing an edit puts every part of the spend back as it was, as a new version', () => {
    const { ctx, later, stored } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const before = stored(id)
    later()
    ok(editSpend(ctx, { id, amount: '5', description: 'Tea' }))
    const edited = stored(id)

    later()
    expect(ok(undoLast(ctx))).toEqual({ spends: [id], accounts: [] })
    const undone = stored(id)
    expect(undone.doc).toEqual(before.doc)
    expect(newer(undone.version, edited.version)).toBe(true)
  })

  test('undo goes back one step at a time, newest first', () => {
    const { ctx, later, listed } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(editSpend(ctx, { id, amount: '5', description: 'Tea' }))
    later()
    ok(undoLast(ctx))
    expect(listed()).toEqual(['Coffee'])
    later()
    ok(undoLast(ctx))
    expect(listed()).toEqual([])
  })

  test('undo all the way back and redo all the way forward, on one spend', () => {
    const { ctx, later, stored, listed } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(editSpend(ctx, { id, amount: '5', description: 'Tea' }))
    later()
    ok(editSpend(ctx, { id, amount: '6', description: 'Cake' }))
    const last = stored(id).doc

    for (const want of [['Tea'], ['Coffee'], []]) {
      later()
      ok(undoLast(ctx))
      expect(listed()).toEqual(want)
    }
    for (const want of [['Coffee'], ['Tea'], ['Cake']]) {
      later()
      ok(redoLast(ctx))
      expect(listed()).toEqual(want)
    }
    expect(stored(id).doc).toEqual(last)
    later()
    ok(undoLast(ctx))
    expect(listed()).toEqual(['Tea'])
  })

  test('a change from elsewhere between two of mine still stops the undo past it', () => {
    const { ledger, ctx, clock, later, stored, listed } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(editSpend(ctx, { id, amount: '5', description: 'Tea' }))
    later()
    fromThePhone(ledger, stored(id).doc, clock.at)
    later()
    ok(editSpend(ctx, { id, amount: '5', description: 'Cake' }))

    later()
    ok(undoLast(ctx))
    expect(listed()).toEqual(['From the phone'])
    later()
    expect(undoLast(ctx)).toMatchObject({ ok: false, failure: { code: 'CHANGED_SINCE' } })
    expect(listed()).toEqual(['From the phone'])
  })

  test('undo is refused whole when a spend in the step changed since, and writes nothing', () => {
    const { ledger, ctx, clock, later, stored } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(editSpend(ctx, { id, amount: '5', description: 'Tea' }))
    later()
    fromThePhone(ledger, stored(id).doc, clock.at)
    const phone = stored(id)

    later()
    expect(undoLast(ctx)).toEqual({
      ok: false,
      failure: { code: 'CHANGED_SINCE', details: { id } },
    })
    expect(stored(id)).toEqual(phone)
  })

  test('a refused undo leaves the history, and the next undo is the step before it', () => {
    const { ledger, ctx, clock, later, stored } = setup()
    const { id: coffee } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    const { id: tea } = ok(writeSpend(ctx, { amount: '3', description: 'Tea' }))
    later()
    fromThePhone(ledger, stored(tea).doc, clock.at)
    later()
    expect(undoLast(ctx).ok).toBe(false)

    later()
    expect(ok(undoLast(ctx))).toEqual({ spends: [coffee], accounts: [] })
  })

  test('redo is refused the same way when the spend changed since', () => {
    const { ledger, ctx, clock, later, stored } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(editSpend(ctx, { id, amount: '5', description: 'Tea' }))
    later()
    ok(undoLast(ctx))
    later()
    fromThePhone(ledger, stored(id).doc, clock.at)

    later()
    expect(redoLast(ctx)).toEqual({
      ok: false,
      failure: { code: 'CHANGED_SINCE', details: { id } },
    })
  })

  test('a new change after an undo empties redo', () => {
    const { ctx, later } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(undoLast(ctx))
    later()
    ok(writeSpend(ctx, { amount: '3', description: 'Tea' }))
    expect(ctx.history.nextRedo()).toBeUndefined()
  })

  test('a refused command adds no step and leaves redo alone', () => {
    const { ctx, later } = setup()
    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(undoLast(ctx))
    const redo = ctx.history.nextRedo()

    expect(writeSpend(ctx, { amount: 'abc', description: 'Tea' }).ok).toBe(false)
    expect(ctx.history.nextUndo()).toBeUndefined()
    expect(ctx.history.nextRedo()).toBe(redo)
  })

  test('a save that changes nothing adds no step', () => {
    const { ctx, later } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(editSpend(ctx, { id, amount: '4.50', description: 'Coffee' }))
    expect(ctx.history.nextUndo()?.name).toEqual({ kind: 'write', description: 'Coffee' })
  })

  test('what Undo and Redo would take is said by name, and nothing is changed by asking', () => {
    const { ctx, later, listed } = setup()
    expect(nextSteps(ctx)).toEqual({ undo: null, redo: null })

    ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    later()
    ok(writeSpend(ctx, { amount: '12', description: 'Lunch' }))
    expect(nextSteps(ctx)).toEqual({ undo: { kind: 'write', description: 'Lunch' }, redo: null })

    later()
    ok(undoLast(ctx))
    expect(nextSteps(ctx)).toEqual({
      undo: { kind: 'write', description: 'Coffee' },
      redo: { kind: 'write', description: 'Lunch' },
    })
    expect(listed()).toEqual(['Coffee'])
  })

  test('with nothing to undo or redo, nothing changes', () => {
    const { ctx } = setup()
    expect(ok(undoLast(ctx))).toEqual({ spends: [], accounts: [] })
    expect(ok(redoLast(ctx))).toEqual({ spends: [], accounts: [] })
  })

  test('undo and redo go through apply: each queues its version to send', () => {
    const { ledger, ctx, later, stored } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    const waiting = () => queued(ledger.db, 10).find((r) => r.docId === id)?.version

    later()
    ok(undoLast(ctx))
    expect(waiting()).toBe(formatVersion(stored(id).version))
    later()
    ok(redoLast(ctx))
    expect(waiting()).toBe(formatVersion(stored(id).version))
  })

  test('each step is named for the menu', () => {
    const { ctx, later } = setup()
    const { id } = ok(writeSpend(ctx, { amount: '4.50', description: 'Coffee' }))
    expect(ctx.history.nextUndo()?.name).toEqual({ kind: 'write', description: 'Coffee' })
    later()
    ok(editSpend(ctx, { id, amount: '5', description: ' Tea ' }))
    expect(ctx.history.nextUndo()?.name).toEqual({ kind: 'edit', description: 'Tea' })
  })
})
