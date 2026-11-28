// The rates for a day into the home currency: typed, one or several as one step, or fetched.

import { addDays, isCalendarDate } from '@have-fish/core/calendar-date'
import { isValidCurrency } from '@have-fish/core/currencies'
import type { RateDoc } from '@have-fish/core/documents'
import { type FailureCode, failure, type Outcome } from '@have-fish/core/outcome'
import type { InputOf, Missed } from '../../../shared/commands'
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

/** Each day's published rate, as one step: a day that got none says why in missed. */
export async function fetchRates(
  ctx: Context,
  input: InputOf<'rate.fetch'>,
): Promise<Outcome<{ ids: string[]; missed: Missed[] }>> {
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
      answer: await ctx.rateSource.rates({
        from: code,
        to: HOME_CURRENCY,
        start: addDays(span.first, -7),
        end: span.last,
      }),
    })),
  )

  const published = new Map<string, readonly PublishedRate[]>()
  const refused = new Map<string, Missed['why']>()
  for (const { code, answer } of answers) {
    if (answer.ok) published.set(code, answer.value)
    else refused.set(code, whyOf(answer.failure.code))
  }

  // The rate each day takes from the week before it, and every day that came with none, in order.
  const taken = new Map<string, PublishedRate>()
  const none: { date: string; currency: string }[] = []
  for (const day of input.days) {
    const rate = latestOn(published.get(day.currency) ?? [], day.date, addDays(day.date, -7))
    if (rate !== undefined) taken.set(`${day.date} ${day.currency}`, rate)
    else if (published.has(day.currency)) none.push(day)
  }

  // What each currency with a missed day falls back to: one ask, after every rates ask.
  const asking = [...new Set(none.map((day) => day.currency))]
  const fallback = new Map<string, Fallback>()
  await Promise.all(
    asking.map(async (code) => {
      const missed = none.filter((day) => day.currency === code)
      fallback.set(code, await fallbackOf(ctx, code, missed))
    }),
  )

  // Read and written after the last wait, so another command can't announce half-way.
  const now = ctx.now()
  const docs: RateDoc[] = []
  const missed: Missed[] = []
  for (const day of input.days) {
    const rate = taken.get(`${day.date} ${day.currency}`)
    if (rate !== undefined) {
      const line = { date: day.date, currency: day.currency, rate: rate.rate }
      docs.push(rateDocOf(ctx, line, now, rate.date))
      continue
    }
    const why = refused.get(day.currency)
    if (why !== undefined) {
      missed.push({ date: day.date, currency: day.currency, why, offer: null })
      continue
    }
    const back = fallback.get(day.currency) ?? NOTHING
    const besideEnd = back.end !== null && back.end < addDays(day.date, -7)
    if (input.last === true && besideEnd && back.offer !== null) {
      const line = { date: day.date, currency: day.currency, rate: back.offer.rate }
      docs.push(rateDocOf(ctx, line, now, back.offer.date))
      continue
    }
    missed.push({
      date: day.date,
      currency: day.currency,
      why: besideEnd && back.offerWhy !== null ? back.offerWhy : back.why,
      offer: besideEnd ? back.offer : null,
    })
  }
  if (docs.length === 0) return { ok: true, value: { ids: [], missed } }
  const { applied, changes } = applyKeeping(ctx, docs, now, docs)
  record(ctx, { action: 'fetchRates', count: docs.length }, changes)
  return outcomeOf(applied, { ids: docs.map((doc) => doc.id), missed })
}

/** What a currency with a missed day falls back to: a refusal, or its last day and its rate. */
type Fallback = {
  /** The last day the service published, or null. */
  end: string | null
  /** Why there is no last day, or 'none' when there is one. */
  why: Missed['why']
  /** The rate on the last day, where the ask for it found one. */
  offer: { date: string; rate: string } | null
  /** Why the ask for the last day's rate gave none, where it refused. */
  offerWhy: Missed['why'] | null
}

/** What a currency with no missed day falls back to: nothing published, and nothing to say. */
const NOTHING: Fallback = { end: null, why: 'none', offer: null, offerWhy: null }

/**
 * What a currency with a missed day falls back to: the last day it published, asked once, and the
 * rate on it where that day is before one of the missed days' week.
 */
async function fallbackOf(
  ctx: Context,
  code: string,
  missed: readonly { date: string; currency: string }[],
): Promise<Fallback> {
  const last = await ctx.rateSource.lastDay({ from: code, to: HOME_CURRENCY })
  if (!last.ok) {
    return { end: null, why: whyOf(last.failure.code), offer: null, offerWhy: null }
  }
  const end = last.value
  if (end === null) return NOTHING
  if (!missed.some((day) => end < addDays(day.date, -7))) {
    return { end, why: 'none', offer: null, offerWhy: null }
  }
  const answer = await ctx.rateSource.rates({ from: code, to: HOME_CURRENCY, start: end, end })
  if (!answer.ok) {
    return { end, why: 'none', offer: null, offerWhy: whyOf(answer.failure.code) }
  }
  const onEnd = answer.value.find((one) => one.date === end)
  const offer = onEnd === undefined ? null : { date: end, rate: onEnd.rate }
  return { end, why: 'none', offer, offerWhy: null }
}

/** The code a day records when the service didn't answer it: the two a source gives. */
const whyOf = (code: FailureCode): Missed['why'] =>
  code === 'RATES_UNREADABLE' ? 'RATES_UNREADABLE' : 'RATES_NOT_FETCHED'

/** The latest of `rates` published from `from` to `date`, whatever order they came in. */
function latestOn(
  rates: readonly PublishedRate[],
  date: string,
  from: string,
): PublishedRate | undefined {
  let latest: PublishedRate | undefined
  for (const entry of rates) {
    if (entry.date > date || entry.date < from) continue
    if (latest === undefined || entry.date > latest.date) latest = entry
  }
  return latest
}
