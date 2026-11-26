import type { RateDoc } from '@have-fish/core/documents'
import { describe, expect, test } from 'vitest'
import { contextFor, type Time } from '../../context'
import { MANUAL, NOW, ok, tempLedger } from '../../ledger/fixtures'
import { rateId } from '../../ledger/rate-id'
import { getDocument } from '../../ledger/store'
import { undoItems } from '../../undo/menu'
import { redoLast, undoLast } from '../../undo/steps'
import { addAccount } from '../accounts/accounts'
import { spendingIn } from '../reports/reports'
import { writeSpend } from '../spends/spends'
import { writeRate } from './rates'

const HOUR = 3_600_000

const refusal = (outcome: { ok: boolean; failure?: unknown }) =>
  outcome.ok ? null : outcome.failure

function setup() {
  const ledger = tempLedger()
  let now = NOW
  const clock: Time = { now: () => now, timeZone: () => 'UTC' }
  const ctx = contextFor({ ledger, announce: () => {}, time: clock })
  /** The rate document stored under `id`, as the ledger holds it. */
  const stored = (id: string) => {
    const found = getDocument(ledger.db, 'rate', id)
    if (found === null) throw new Error(`no rate ${id}`)
    return found.doc
  }
  /** How many rows a table holds. */
  const count = (table: string) => ledger.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()
  /** The 4.20 GBP spend from a wallet kept to GBP, on 5 November. */
  const gbpSpend = () => {
    const wallet = ok(addAccount(ctx, { name: 'cash:gbp', kind: 'cash', currency: 'GBP' })).id
    return ok(
      writeSpend(ctx, {
        amount: '4.20',
        description: '',
        to: { category: 'food' },
        from: wallet,
        date: '2026-11-05',
      }),
    ).id
  }
  /** The week's spending, Tuesday the 3rd of November to Monday the 9th. */
  const week = () => ok(spendingIn(ledger.db, { start: '2026-11-03', end: '2026-11-09' }))
  /** An hour on, so the next write is a later version. */
  const later = () => {
    now += HOUR
  }
  return { ctx, stored, count, gbpSpend, week, later }
}

describe('writing a rate', () => {
  test('writes the rate I typed for its day, into the home currency', () => {
    const { ctx, stored } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))

    expect(stored(id)).toEqual<RateDoc>({
      type: 'rate',
      id,
      date: '2026-11-05',
      from: 'GBP',
      to: 'CAD',
      rate: '1.72',
      published: null,
      deletedAt: null,
      origin: { source: 'manual', createdAt: NOW, deviceId: ctx.ledger.meta.deviceId },
    })
  })

  test("takes the id from the rate's source, day and pair", () => {
    const { ctx } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))

    expect(id).toBe(rateId({ date: '2026-11-05', from: 'GBP', to: 'CAD', origin: MANUAL }))
  })

  test('keeps the rate as I typed it, a trailing zero and all', () => {
    const { ctx, stored } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.50' }))

    expect(stored(id).rate).toBe('1.50')
  })

  test('drops the space around the rate I typed', () => {
    const { ctx, stored } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: ' 1.72 ' }))

    expect(stored(id).rate).toBe('1.72')
  })

  test("is a new version of the day's rate when I type it again", () => {
    const { ctx, stored, count } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.71' }))
    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))

    expect(count('rates')).toBe(1)
    expect(stored(id).rate).toBe('1.72')
  })

  test('keeps the origin the day first got when I type it again later', () => {
    const { ctx, stored, later } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.71' }))
    later()
    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))

    expect(stored(id).rate).toBe('1.72')
    expect(stored(id).origin.createdAt).toBe(NOW)
  })

  test('is a document of its own on another day', () => {
    const { ctx, count } = setup()

    const first = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.71' })).id
    const second = ok(writeRate(ctx, { date: '2026-11-06', currency: 'GBP', rate: '1.72' })).id

    expect(count('rates')).toBe(2)
    expect(first).not.toBe(second)
  })

  test('converts the week at the rate I typed on its day', () => {
    const { ctx, week, gbpSpend } = setup()
    const id = gbpSpend()

    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))

    expect(week().spent).toEqual([{ id, category: 'food', amount: '7.22', mark: 'mine' }])
  })
})

describe('a rate the ledger refuses', () => {
  test('is text that is not a rate, said with what it got', () => {
    const { ctx } = setup()

    expect(refusal(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.7x' }))).toEqual({
      code: 'RATE_INVALID',
      details: { rate: '1.7x' },
    })
  })

  test('writes nothing', () => {
    const { ctx, count } = setup()

    expect(
      refusal(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.7x' })),
    ).toMatchObject({ code: 'RATE_INVALID' })

    expect(count('rates')).toBe(0)
  })

  test('is a negative rate', () => {
    const { ctx } = setup()

    expect(refusal(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '-1.72' }))).toEqual(
      { code: 'RATE_INVALID', details: { rate: '-1.72' } },
    )
  })

  test('is an exponent', () => {
    const { ctx } = setup()

    expect(refusal(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1e2' }))).toEqual({
      code: 'RATE_INVALID',
      details: { rate: '1e2' },
    })
  })

  test('is an empty rate', () => {
    const { ctx } = setup()

    expect(refusal(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '' }))).toEqual({
      code: 'RATE_INVALID',
      details: { rate: '' },
    })
  })

  test('is zero', () => {
    const { ctx } = setup()

    expect(refusal(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '0' }))).toEqual({
      code: 'RATE_INVALID',
      details: { rate: '0' },
    })
  })

  test('is the home currency as its own pair, and writes nothing', () => {
    const { ctx, count } = setup()

    expect(refusal(writeRate(ctx, { date: '2026-11-05', currency: 'CAD', rate: '1.72' }))).toEqual({
      code: 'RATE_SAME_CURRENCY',
      details: { currency: 'CAD' },
    })
    expect(count('rates')).toBe(0)
  })

  test('is a currency the app does not hold, and writes nothing', () => {
    const { ctx, count } = setup()

    expect(refusal(writeRate(ctx, { date: '2026-11-05', currency: 'XYZ', rate: '1.72' }))).toEqual({
      code: 'UNSUPPORTED_CURRENCY',
      details: { currency: 'XYZ' },
    })
    expect(count('rates')).toBe(0)
  })

  test('is a day that is no day, and writes nothing', () => {
    const { ctx, count } = setup()

    expect(
      refusal(writeRate(ctx, { date: '2026-02-30', currency: 'GBP', rate: '1.72' })),
    ).toMatchObject({ code: 'DATE_INVALID' })
    expect(count('rates')).toBe(0)
  })
})

describe('undoing a rate', () => {
  test('takes the rate out', () => {
    const { ctx, stored } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))
    undoLast(ctx)

    expect(stored(id).deletedAt).not.toBeNull()
  })

  test('takes the rate out, and the week counts the spend as missing', () => {
    const { ctx, week, gbpSpend } = setup()
    const id = gbpSpend()
    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))

    undoLast(ctx)

    expect(week().spent).toEqual([
      {
        id,
        category: 'food',
        amount: '0.00',
        mark: 'missing',
        guess: { date: '2026-11-05', currency: 'GBP', from: null },
      },
    ])
  })

  test('puts the rate back on redo', () => {
    const { ctx, stored } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))
    undoLast(ctx)
    expect(stored(id).deletedAt).not.toBeNull()

    redoLast(ctx)

    expect(stored(id).rate).toBe('1.72')
    expect(stored(id).deletedAt).toBeNull()
  })

  test('from a second rate on the day puts the first back', () => {
    const { ctx, stored } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.71' }))
    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))
    expect(stored(id).rate).toBe('1.72')

    undoLast(ctx)

    expect(stored(id).rate).toBe('1.71')
    expect(stored(id).deletedAt).toBeNull()
  })

  test("then a rate typed again keeps the tombstone's origin", () => {
    const { ctx, stored, later } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))
    undoLast(ctx)
    later()

    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.73' }))

    expect(stored(id).rate).toBe('1.73')
    expect(stored(id).deletedAt).toBeNull()
  })

  test('records no step for a refused rate', () => {
    const { ctx } = setup()

    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.71' }))
    expect(
      refusal(writeRate(ctx, { date: '2026-11-06', currency: 'GBP', rate: '1.7x' })),
    ).toMatchObject({ code: 'RATE_INVALID' })

    expect(undoItems(ctx.history, { undo: false, redo: false }).undo.label).toBe(
      'Undo GBP rate for 2026-11-05',
    )
  })

  test('leaves the window where it is', () => {
    const { ctx, stored } = setup()

    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))
    const moved = undoLast(ctx)
    expect(stored(id).deletedAt).not.toBeNull()

    expect(moved).toEqual({ ok: true, value: { spends: [], accounts: [] } })
  })

  test('names the step for the rate', () => {
    const { ctx } = setup()

    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))

    expect(undoItems(ctx.history, { undo: false, redo: false }).undo.label).toBe(
      'Undo GBP rate for 2026-11-05',
    )
  })
})
