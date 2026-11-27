import { addDays } from '@have-fish/core/calendar-date'
import type { RateDoc } from '@have-fish/core/documents'
import { failure } from '@have-fish/core/outcome'
import { describe, expect, test } from 'vitest'
import { rateInputs } from '../../../shared/commands'
import { type Log, runCommand } from '../../commands/run'
import { contextFor, type Time } from '../../context'
import { MANUAL, NOW, ok, SYSTEM, tempLedger } from '../../ledger/fixtures'
import { rateId } from '../../ledger/rate-id'
import { getDocument } from '../../ledger/store'
import type { PublishedRate, RateAsk, RateSource } from '../../rate-source'
import { undoItems } from '../../undo/menu'
import { redoLast, undoLast } from '../../undo/steps'
import { addAccount } from '../accounts/accounts'
import { spendingIn } from '../reports/reports'
import { writeSpend } from '../spends/spends'
import { fetchRates, writeAllRates, writeRate } from './rates'

const HOUR = 3_600_000

const refusal = (outcome: { ok: boolean; failure?: unknown }) =>
  outcome.ok ? null : outcome.failure

/** A day and currency a fetch asks the published rate of. */
const day = (date: string, currency = 'JPY') => ({ date, currency })

function setup(book: Record<string, readonly PublishedRate[] | null> = {}) {
  const ledger = tempLedger()
  let now = NOW
  const clock: Time = { now: () => now, timeZone: () => 'UTC' }
  const asks: RateAsk[] = []
  let held: Promise<void> | null = null
  /** What the stand-in published, by currency: null refuses, and a code it lacks has none. */
  const rateSource: RateSource = async (ask) => {
    asks.push(ask)
    if (held !== null) await held
    const rates = book[ask.from]
    if (rates === undefined) return { ok: true, value: [] }
    if (rates === null) return failure('RATES_NOT_FETCHED')
    return { ok: true, value: [...rates] }
  }
  /** Holds the stand-in's answers until the function it returns is called. */
  const hold = () => {
    const gate = Promise.withResolvers<void>()
    held = gate.promise
    return () => gate.resolve()
  }
  const ctx = contextFor({ ledger, announce: () => {}, time: clock, rateSource })
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
  return { ctx, stored, count, gbpSpend, week, later, asks, hold }
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
        uncounted: { amount: '4.20', currency: 'GBP' },
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

describe('writing several rates', () => {
  /** The input writing each of `rates` on `date`, as the command takes them. */
  const ratesOn = (date: string, rates: readonly { currency: string; rate: string }[]) => ({
    rates: rates.map((one) => ({ date, ...one })),
  })

  /** `days` rates of GBP, one a day from 2026-01-01 on. */
  const manyRates = (days: number) => ({
    rates: Array.from({ length: days }, (_, at) => ({
      date: addDays('2026-01-01', at),
      currency: 'GBP',
      rate: '1.71',
    })),
  })

  test('writes every rate of the batch, each into the home currency', () => {
    const { ctx, stored } = setup()

    const answer = ok(
      writeAllRates(
        ctx,
        ratesOn('2026-11-05', [
          { currency: 'GBP', rate: '1.71' },
          { currency: 'JPY', rate: '0.0091' },
        ]),
      ),
    )

    expect(
      answer.ids
        .map((id) => stored(id))
        .map((one) => [one.from, one.to, one.rate, one.origin.source]),
    ).toEqual([
      ['GBP', 'CAD', '1.71', 'manual'],
      ['JPY', 'CAD', '0.0091', 'manual'],
    ])
  })

  test("answers each rate's id, in the order the rates came", () => {
    const { ctx } = setup()

    const answer = ok(
      writeAllRates(
        ctx,
        ratesOn('2026-11-05', [
          { currency: 'JPY', rate: '0.0091' },
          { currency: 'GBP', rate: '1.71' },
        ]),
      ),
    )

    expect(answer.ids).toEqual([
      rateId({ date: '2026-11-05', from: 'JPY', to: 'CAD', origin: MANUAL }),
      rateId({ date: '2026-11-05', from: 'GBP', to: 'CAD', origin: MANUAL }),
    ])
  })

  test('trims each rate as it writes it', () => {
    const { ctx, stored } = setup()

    const answer = ok(
      writeAllRates(ctx, ratesOn('2026-11-05', [{ currency: 'GBP', rate: ' 1.72 ' }])),
    )

    expect(answer.ids.map((id) => stored(id).rate)).toEqual(['1.72'])
  })

  test('keeps the origin a day already had when the batch writes it again', () => {
    const { ctx, stored, later } = setup()
    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.71' }))
    later()

    const answer = ok(
      writeAllRates(ctx, ratesOn('2026-11-05', [{ currency: 'GBP', rate: '1.80' }])),
    )

    expect(answer.ids.map((id) => stored(id).origin.createdAt)).toEqual([NOW])
  })

  test('refuses the batch with the rate it could not read', () => {
    const { ctx } = setup()

    expect(
      refusal(
        writeAllRates(
          ctx,
          ratesOn('2026-11-05', [
            { currency: 'GBP', rate: '1.71' },
            { currency: 'JPY', rate: '1.7x' },
          ]),
        ),
      ),
    ).toEqual({ code: 'RATE_INVALID', details: { rate: '1.7x' } })
  })

  test('writes none of the batch when one rate is refused', () => {
    const { ctx, count } = setup()

    refusal(
      writeAllRates(
        ctx,
        ratesOn('2026-11-05', [
          { currency: 'GBP', rate: '1.71' },
          { currency: 'JPY', rate: '1.7x' },
        ]),
      ),
    )

    expect(count('rates')).toBe(0)
  })

  test('takes every rate of the batch out on one undo', () => {
    const { ctx, stored } = setup()
    const answer = ok(
      writeAllRates(
        ctx,
        ratesOn('2026-11-05', [
          { currency: 'GBP', rate: '1.71' },
          { currency: 'JPY', rate: '0.0091' },
        ]),
      ),
    )

    undoLast(ctx)

    expect(answer.ids.map((id) => stored(id).deletedAt !== null)).toEqual([true, true])
  })

  test('puts every rate of the batch back on one redo', () => {
    const { ctx, stored } = setup()
    const answer = ok(
      writeAllRates(
        ctx,
        ratesOn('2026-11-05', [
          { currency: 'GBP', rate: '1.71' },
          { currency: 'JPY', rate: '0.0091' },
        ]),
      ),
    )
    undoLast(ctx)

    redoLast(ctx)

    expect(answer.ids.map((id) => stored(id).deletedAt)).toEqual([null, null])
  })

  test('names the step by how many rates it holds', () => {
    const { ctx } = setup()

    ok(
      writeAllRates(
        ctx,
        ratesOn('2026-11-05', [
          { currency: 'GBP', rate: '1.71' },
          { currency: 'JPY', rate: '0.0091' },
        ]),
      ),
    )

    expect(undoItems(ctx.history, { undo: false, redo: false }).undo.label).toBe('Undo 2 rates')
  })

  test('marks the week mine once the rate for its day is written', () => {
    const { ctx, week, gbpSpend } = setup()
    const id = gbpSpend()
    ok(writeRate(ctx, { date: '2026-11-02', currency: 'GBP', rate: '1.75' }))
    expect(week().spent).toEqual([
      {
        id,
        category: 'food',
        amount: '7.35',
        mark: 'borrowed',
        guess: { date: '2026-11-05', currency: 'GBP', from: { date: '2026-11-02', rate: '1.75' } },
      },
    ])

    ok(writeAllRates(ctx, ratesOn('2026-11-05', [{ currency: 'GBP', rate: '1.71' }])))

    expect(week().spent).toEqual([{ id, category: 'food', amount: '7.18', mark: 'mine' }])
  })

  test('refuses a batch that writes one day and currency twice', () => {
    const parsed = rateInputs['rate.writeAll'].safeParse(
      ratesOn('2026-11-05', [
        { currency: 'GBP', rate: '1.71' },
        { currency: 'GBP', rate: '1.72' },
      ]),
    )

    expect(parsed.success).toBe(false)
  })

  test('allows the same currency on two days', () => {
    const parsed = rateInputs['rate.writeAll'].safeParse({
      rates: [
        { date: '2026-11-05', currency: 'GBP', rate: '1.71' },
        { date: '2026-11-06', currency: 'GBP', rate: '1.72' },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  test('refuses a batch of no rates', () => {
    expect(rateInputs['rate.writeAll'].safeParse({ rates: [] }).success).toBe(false)
  })

  test('allows a batch of a hundred rates', () => {
    expect(rateInputs['rate.writeAll'].safeParse(manyRates(100)).success).toBe(true)
  })

  test('refuses a batch of a hundred and one', () => {
    expect(rateInputs['rate.writeAll'].safeParse(manyRates(101)).success).toBe(false)
  })

  test('adds no step for a refused batch', () => {
    const { ctx } = setup()
    ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.71' }))

    refusal(
      writeAllRates(
        ctx,
        ratesOn('2026-11-06', [
          { currency: 'GBP', rate: '1.80' },
          { currency: 'JPY', rate: '1.7x' },
        ]),
      ),
    )

    expect(undoItems(ctx.history, { undo: false, redo: false }).undo.label).toBe(
      'Undo GBP rate for 2026-11-05',
    )
  })

  test('leaves the window where it is when the batch is undone', () => {
    const { ctx } = setup()
    ok(
      writeAllRates(
        ctx,
        ratesOn('2026-11-05', [
          { currency: 'GBP', rate: '1.71' },
          { currency: 'JPY', rate: '0.0091' },
        ]),
      ),
    )

    expect(undoLast(ctx)).toEqual({ ok: true, value: { spends: [], accounts: [] } })
  })
})

/** The edge's log, its lines kept as main writes them. */
function aLog() {
  const info: string[] = []
  const error: string[] = []
  const thrown: unknown[] = []
  const log: Log = {
    info: (line) => info.push(line),
    error: (line, e) => {
      error.push(line)
      thrown.push(e)
    },
  }
  return { log, info, error, thrown }
}

describe('fetching rates', () => {
  test('writes the rate the service published, on the day asked, into the home currency', async () => {
    const { ctx, stored } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }] })

    const { ids } = ok(await fetchRates(ctx, { days: [day('2026-11-05')] }))
    const id = ids[0] as string

    expect(stored(id)).toEqual<RateDoc>({
      type: 'rate',
      id,
      date: '2026-11-05',
      from: 'JPY',
      to: 'CAD',
      rate: '0.0091',
      published: '2026-11-05',
      deletedAt: null,
      origin: { source: 'system', createdAt: NOW, deviceId: ctx.ledger.meta.deviceId },
    })
  })

  test("takes the fetched id from the rate's source, day and pair", async () => {
    const { ctx } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }] })

    const { ids } = ok(await fetchRates(ctx, { days: [day('2026-11-05')] }))

    expect(ids[0]).toBe(rateId({ date: '2026-11-05', from: 'JPY', to: 'CAD', origin: SYSTEM }))
  })

  test('asks one range, from a week before the earliest day to the latest', async () => {
    const { ctx, asks } = setup({ JPY: [] })

    await fetchRates(ctx, { days: [day('2026-11-07'), day('2026-11-05')] })

    expect(asks).toEqual([{ from: 'JPY', to: 'CAD', start: '2026-10-29', end: '2026-11-07' }])
  })

  test('asks once for each currency, a week before its own first day', async () => {
    const { ctx, asks } = setup({ JPY: [], GBP: [] })

    await fetchRates(ctx, {
      days: [day('2026-11-05'), day('2026-11-06', 'GBP'), day('2026-11-06')],
    })

    expect(asks).toEqual([
      { from: 'JPY', to: 'CAD', start: '2026-10-29', end: '2026-11-06' },
      { from: 'GBP', to: 'CAD', start: '2026-10-30', end: '2026-11-06' },
    ])
  })

  test('a day the service published nothing for takes the last rate before it', async () => {
    const { ctx, stored } = setup({
      JPY: [
        { date: '2026-11-06', rate: '0.0090' },
        { date: '2026-11-09', rate: '0.0092' },
      ],
    })

    const { ids } = ok(await fetchRates(ctx, { days: [day('2026-11-07')] }))
    const doc = stored(ids[0] as string)

    expect({ date: doc.date, published: doc.published, rate: doc.rate }).toEqual({
      date: '2026-11-07',
      published: '2026-11-06',
      rate: '0.0090',
    })
  })

  test('the latest published day on or before the one asked, whatever order it came in', async () => {
    const { ctx, stored } = setup({
      JPY: [
        { date: '2026-11-04', rate: '0.0090' },
        { date: '2026-11-05', rate: '0.0091' },
        { date: '2026-11-03', rate: '0.0089' },
      ],
    })

    const { ids } = ok(await fetchRates(ctx, { days: [day('2026-11-06')] }))
    const doc = stored(ids[0] as string)

    expect({ published: doc.published, rate: doc.rate }).toEqual({
      published: '2026-11-05',
      rate: '0.0091',
    })
  })

  test('a day with nothing published on or before it gets no rate and writes nothing', async () => {
    const { ctx, count } = setup({ JPY: [{ date: '2026-11-06', rate: '0.0092' }] })

    expect(await fetchRates(ctx, { days: [day('2026-11-05')] })).toEqual({
      ok: true,
      value: { ids: [] },
    })
    expect(count('rates')).toBe(0)
  })

  test('a fetch that got nothing records no step', async () => {
    const { ctx } = setup({ JPY: [{ date: '2026-11-06', rate: '0.0092' }] })

    await fetchRates(ctx, { days: [day('2026-11-05')] })

    expect(ctx.history.nextUndo()).toBeUndefined()
  })

  test('a currency the service does not quote is left as it was, and the others are written', async () => {
    const { ctx, count } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }] })

    const { ids } = ok(
      await fetchRates(ctx, { days: [day('2026-11-05'), day('2026-11-05', 'NTD')] }),
    )

    expect(ids).toEqual([rateId({ date: '2026-11-05', from: 'JPY', to: 'CAD', origin: SYSTEM })])
    expect(count('rates')).toBe(1)
  })

  test('answers the ids in the order the days came', async () => {
    const { ctx } = setup({
      JPY: [
        { date: '2026-11-05', rate: '0.0091' },
        { date: '2026-11-06', rate: '0.0092' },
      ],
      GBP: [{ date: '2026-11-05', rate: '1.71' }],
    })

    const { ids } = ok(
      await fetchRates(ctx, {
        days: [day('2026-11-05'), day('2026-11-05', 'GBP'), day('2026-11-06')],
      }),
    )

    expect(ids).toEqual([
      rateId({ date: '2026-11-05', from: 'JPY', to: 'CAD', origin: SYSTEM }),
      rateId({ date: '2026-11-05', from: 'GBP', to: 'CAD', origin: SYSTEM }),
      rateId({ date: '2026-11-06', from: 'JPY', to: 'CAD', origin: SYSTEM }),
    ])
  })

  test('leaves the rate I typed for that day as it was', async () => {
    const { ctx, stored } = setup({ GBP: [{ date: '2026-11-05', rate: '1.80' }] })
    const { id } = ok(writeRate(ctx, { date: '2026-11-05', currency: 'GBP', rate: '1.72' }))
    const before = stored(id)

    await fetchRates(ctx, { days: [day('2026-11-05', 'GBP')] })

    expect(stored(id)).toEqual(before)
  })

  test("a fetched rate marks the week's spend an estimate", async () => {
    const { ctx, gbpSpend, week } = setup({ GBP: [{ date: '2026-11-05', rate: '1.80' }] })
    gbpSpend()
    expect(week().spent[0]?.mark).toBe('missing')

    await fetchRates(ctx, { days: [day('2026-11-05', 'GBP')] })

    expect(week().spent[0]?.mark).toBe('estimate')
  })

  test('one undo takes every rate the fetch wrote', async () => {
    const { ctx, stored } = setup({
      JPY: [{ date: '2026-11-05', rate: '0.0091' }],
      GBP: [{ date: '2026-11-05', rate: '1.71' }],
    })
    const { ids } = ok(
      await fetchRates(ctx, { days: [day('2026-11-05'), day('2026-11-05', 'GBP')] }),
    )

    undoLast(ctx)

    for (const id of ids) expect(stored(id).deletedAt).not.toBeNull()
  })

  test('one redo puts them back', async () => {
    const { ctx, stored } = setup({
      JPY: [{ date: '2026-11-05', rate: '0.0091' }],
      GBP: [{ date: '2026-11-05', rate: '1.71' }],
    })
    const { ids } = ok(
      await fetchRates(ctx, { days: [day('2026-11-05'), day('2026-11-05', 'GBP')] }),
    )
    undoLast(ctx)

    redoLast(ctx)

    for (const id of ids) expect(stored(id).deletedAt).toBeNull()
  })

  test('one step names how many rates it fetched', async () => {
    const { ctx } = setup({
      JPY: [{ date: '2026-11-05', rate: '0.0091' }],
      GBP: [{ date: '2026-11-05', rate: '1.71' }],
    })
    await fetchRates(ctx, { days: [day('2026-11-05'), day('2026-11-05', 'GBP')] })

    expect(undoItems(ctx.history, { undo: false, redo: false }).undo.label).toBe(
      'Undo 2 fetched rates',
    )
  })

  test("a fetch again after an undo keeps the tombstone's origin", async () => {
    const book: Record<string, readonly PublishedRate[] | null> = {
      JPY: [{ date: '2026-11-05', rate: '0.0091' }],
    }
    const { ctx, stored, later } = setup(book)
    const first = ok(await fetchRates(ctx, { days: [day('2026-11-05')] })).ids[0] as string
    undoLast(ctx)
    later()
    book.JPY = [{ date: '2026-11-05', rate: '0.0093' }]

    const again = ok(await fetchRates(ctx, { days: [day('2026-11-05')] })).ids[0] as string

    expect(again).toBe(first)
    expect(stored(again)).toMatchObject({
      rate: '0.0093',
      deletedAt: null,
      origin: { createdAt: NOW },
    })
  })

  test('an undo of fetched rates leaves the window where it is', async () => {
    const { ctx } = setup({
      JPY: [{ date: '2026-11-05', rate: '0.0091' }],
      GBP: [{ date: '2026-11-05', rate: '1.71' }],
    })
    await fetchRates(ctx, { days: [day('2026-11-05'), day('2026-11-05', 'GBP')] })

    expect(undoLast(ctx)).toEqual({ ok: true, value: { spends: [], accounts: [] } })
  })

  test('nothing is written until the last wait is over', async () => {
    const { ctx, count, hold } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }] })
    const release = hold()

    const fetching = fetchRates(ctx, { days: [day('2026-11-05')] })
    expect(count('rates')).toBe(0)
    release()
    await fetching

    expect(count('rates')).toBe(1)
  })

  test('the schema refuses a day and currency twice', () => {
    const twice = { days: [day('2026-11-05'), day('2026-11-05')] }

    expect(rateInputs['rate.fetch'].safeParse(twice).success).toBe(false)
  })

  test('the schema takes two days of one currency', () => {
    const days = { days: [day('2026-11-05'), day('2026-11-06')] }

    expect(rateInputs['rate.fetch'].safeParse(days).success).toBe(true)
  })

  test('the schema refuses no days', () => {
    expect(rateInputs['rate.fetch'].safeParse({ days: [] }).success).toBe(false)
  })

  test('the schema takes 200 days', () => {
    expect(rateInputs['rate.fetch'].safeParse({ days: manyDays(200) }).success).toBe(true)
  })

  test('the schema refuses 201 days', () => {
    expect(rateInputs['rate.fetch'].safeParse({ days: manyDays(201) }).success).toBe(false)
  })
})

/** `count` days of JPY, from 1 January 2026, each once. */
const manyDays = (count: number) =>
  Array.from({ length: count }, (_, i) => day(addDays('2026-01-01', i)))

describe('a fetch refused', () => {
  test('one refused answer refuses the whole fetch', async () => {
    const { ctx } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }], GBP: null })

    expect(await fetchRates(ctx, { days: [day('2026-11-05'), day('2026-11-05', 'GBP')] })).toEqual(
      failure('RATES_NOT_FETCHED'),
    )
  })

  test('and nothing is written, the answer that came good too', async () => {
    const { ctx, count } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }], GBP: null })

    await fetchRates(ctx, { days: [day('2026-11-05'), day('2026-11-05', 'GBP')] })

    expect(count('rates')).toBe(0)
  })

  test('and no step is recorded', async () => {
    const { ctx } = setup({ GBP: null })
    ok(writeRate(ctx, { date: '2026-11-04', currency: 'GBP', rate: '1.72' }))

    await fetchRates(ctx, { days: [day('2026-11-05', 'GBP')] })

    expect(undoItems(ctx.history, { undo: false, redo: false }).undo.label).toBe(
      'Undo GBP rate for 2026-11-04',
    )
  })

  test('a code that is no currency is refused before anything is sent', async () => {
    const { ctx } = setup()

    expect(await fetchRates(ctx, { days: [day('2026-11-05', 'XYZ')] })).toEqual(
      failure('UNSUPPORTED_CURRENCY', { currency: 'XYZ' }),
    )
  })

  test('the home currency is refused', async () => {
    const { ctx } = setup()

    expect(await fetchRates(ctx, { days: [day('2026-11-05', 'CAD')] })).toEqual(
      failure('RATE_SAME_CURRENCY', { currency: 'CAD' }),
    )
  })

  test('a day that is no day is refused', async () => {
    const { ctx } = setup()

    expect(await fetchRates(ctx, { days: [day('2026-02-30')] })).toEqual(
      failure('DATE_INVALID', { date: '2026-02-30' }),
    )
  })

  test.each([
    ['XYZ', '2026-11-05'],
    ['CAD', '2026-11-05'],
    ['JPY', '2026-02-30'],
  ])('%s on %s is never sent', async (currency, date) => {
    const { ctx, asks } = setup({ [currency]: [] })

    await fetchRates(ctx, { days: [day(date, currency)] })

    expect(asks).toEqual([])
  })
})

describe('fetching through the edge', () => {
  test('rate.fetch answers a Promise', async () => {
    const { ctx } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }] })
    const { log } = aLog()

    const answer = runCommand(ctx, 'rate.fetch', { days: [day('2026-11-05')] }, log)

    expect(answer).toBeInstanceOf(Promise)
    await answer
  })

  test('and the rate it fetched crosses as ok', async () => {
    const { ctx } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }] })
    const { log } = aLog()

    const answer = await runCommand(ctx, 'rate.fetch', { days: [day('2026-11-05')] }, log)

    expect(answer).toEqual({
      ok: true,
      value: { ids: [rateId({ date: '2026-11-05', from: 'JPY', to: 'CAD', origin: SYSTEM })] },
    })
  })

  test('its log line holds no day or currency', async () => {
    const { ctx } = setup({ JPY: [{ date: '2026-11-05', rate: '0.0091' }] })
    const { log, info, error } = aLog()

    await runCommand(ctx, 'rate.fetch', { days: [day('2026-11-05')] }, log)

    expect([...info, ...error].filter((line) => /JPY|2026-11-05/.test(line))).toEqual([])
  })

  test('a refused fetch logs its code, and no error', async () => {
    const { ctx } = setup({ JPY: null })
    const { log, info, error } = aLog()

    await runCommand(ctx, 'rate.fetch', { days: [day('2026-11-05')] }, log)

    expect(info).toHaveLength(1)
    expect(info[0] ?? '').toMatch(/ RATES_NOT_FETCHED$/)
    expect(error).toEqual([])
  })
})
