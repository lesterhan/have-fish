// The rates for a day into the home currency: typed, one or several as one step, or fetched.

import { addDays, isCalendarDate } from '@have-fish/core/calendar-date'
import { isValidCurrency } from '@have-fish/core/currencies'
import type { RateDoc } from '@have-fish/core/documents'
import { failure, type Outcome } from '@have-fish/core/outcome'
import type { InputOf } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'
import { idOf, outcomeOf } from '../../commands/applied'
import type { Context } from '../../context'
import { rateId } from '../../ledger/rate-id'
import { getDocument } from '../../ledger/store'
import type { PublishedRate } from '../../rate-source'
import { applyKeeping, record } from '../../undo/steps'

/** A rate document, typed or fetched on `published`, a new version of the day's: origin kept. */
function rateDocOf(
  ctx: Context,
  line: InputOf<'rate.write'>,
  now: number,
  published: string | null = null,
): RateDoc {
  const { db } = ctx.ledger
  const fields = { date: line.date, from: line.currency, to: HOME_CURRENCY }
  const made = {
    source: published === null ? 'manual' : 'system',
    createdAt: now,
    deviceId: ctx.ledger.meta.deviceId,
  } as const
  const id = rateId({ ...fields, origin: made })
  const stored = getDocument(db, 'rate', id)
  const origin = stored?.doc.origin ?? made
  return {
    type: 'rate',
    id,
    ...fields,
    rate: line.rate.trim(),
    published,
    deletedAt: null,
    origin,
  }
}

/**
 * The day's rate from a currency I typed, as a new version of the day's document when there is
 * one. It keeps the stored origin, a tombstone's too: apply refuses a write that changes one.
 */
export function writeRate(ctx: Context, input: InputOf<'rate.write'>): Outcome<{ id: string }> {
  const now = ctx.now()
  const doc = rateDocOf(ctx, input, now)
  const { applied, changes } = applyKeeping(ctx, [doc], now, [doc])
  record(ctx, { action: 'writeRate', currency: input.currency, date: input.date }, changes)
  return idOf(applied, doc.id)
}

/** The rates I typed, as one step: written whole or refused whole. */
export function writeAllRates(
  ctx: Context,
  input: InputOf<'rate.writeAll'>,
): Outcome<{ ids: string[] }> {
  const now = ctx.now()
  const docs = input.rates.map((one) => rateDocOf(ctx, one, now))
  const { applied, changes } = applyKeeping(ctx, docs, now, docs)
  record(ctx, { action: 'writeAllRates', count: docs.length }, changes)
  return outcomeOf(applied, { ids: docs.map((doc) => doc.id) })
}

/**
 * The published rate for each day and currency asked, into the home currency, as one step. A
 * day the service published nothing on or before gets none; any answer refused refuses all.
 */
export async function fetchRates(
  ctx: Context,
  input: InputOf<'rate.fetch'>,
): Promise<Outcome<{ ids: string[] }>> {
  // Checked before anything is sent: each day and code goes into the request.
  for (const day of input.days) {
    if (!isCalendarDate(day.date)) return failure('DATE_INVALID', { date: day.date })
    if (!isValidCurrency(day.currency)) {
      return failure('UNSUPPORTED_CURRENCY', { currency: day.currency })
    }
    if (day.currency === HOME_CURRENCY) {
      return failure('RATE_SAME_CURRENCY', { currency: day.currency })
    }
  }

  // Each currency's first and last day, in the order each first comes: one ask for each.
  const spans = new Map<string, { first: string; last: string }>()
  for (const day of input.days) {
    const span = spans.get(day.currency)
    if (span === undefined) spans.set(day.currency, { first: day.date, last: day.date })
    else {
      if (day.date < span.first) span.first = day.date
      if (day.date > span.last) span.last = day.date
    }
  }
  const answers = await Promise.all(
    [...spans.entries()].map(async ([code, span]) => ({
      code,
      answer: await ctx.rateSource({
        from: code,
        to: HOME_CURRENCY,
        start: addDays(span.first, -7),
        end: span.last,
      }),
    })),
  )

  const published = new Map<string, readonly PublishedRate[]>()
  for (const { code, answer } of answers) {
    if (!answer.ok) return { ok: false, failure: answer.failure }
    published.set(code, answer.value)
  }

  // Read and written after the last wait, so another command can't announce half-way.
  const now = ctx.now()
  const docs: RateDoc[] = []
  for (const day of input.days) {
    const found = latestOn(published.get(day.currency) ?? [], day.date)
    if (found === undefined) continue
    const line = { date: day.date, currency: day.currency, rate: found.rate }
    docs.push(rateDocOf(ctx, line, now, found.date))
  }
  if (docs.length === 0) return { ok: true, value: { ids: [] } }
  const { applied, changes } = applyKeeping(ctx, docs, now, docs)
  record(ctx, { action: 'fetchRates', count: docs.length }, changes)
  return outcomeOf(applied, { ids: docs.map((doc) => doc.id) })
}

/** The latest of `rates` published on or before `date`, whatever order they came in. */
function latestOn(rates: readonly PublishedRate[], date: string): PublishedRate | undefined {
  let latest: PublishedRate | undefined
  for (const entry of rates) {
    if (entry.date > date) continue
    if (latest === undefined || entry.date > latest.date) latest = entry
  }
  return latest
}
