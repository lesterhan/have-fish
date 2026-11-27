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

/**
 * Each day's published rate, as one step: a day that got none says why in missed.
 */
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

  // The rate each day takes from the week before it, and every day that got none, in its order.
  const taken = new Map<string, PublishedRate>()
  const none: { date: string; currency: string }[] = []
  for (const one of input.days) {
    const rate = latestOn(published.get(one.currency) ?? [], one.date, addDays(one.date, -7))
    if (rate === undefined) none.push(one)
    else taken.set(`${one.date} ${one.currency}`, rate)
  }

  // The last day each currency with a missed day published: one ask, after every rates ask.
  const asking = [...new Set(none.map((one) => one.currency))].filter((code) => !refused.has(code))
  const lastOf = new Map<string, { end: string | null } | { why: Missed['why'] }>()
  await Promise.all(
    asking.map(async (code) => {
      const answer = await ctx.rateSource.lastDay({ from: code, to: HOME_CURRENCY })
      lastOf.set(code, answer.ok ? { end: answer.value } : { why: whyOf(answer.failure.code) })
    }),
  )

  // A currency whose last day is before a missed day's week: one more ask, for the rate on it.
  const ends = new Map<string, string>()
  for (const code of asking) {
    const last = lastOf.get(code)
    const end = last !== undefined && 'end' in last ? last.end : null
    if (end === null) continue
    if (none.some((one) => one.currency === code && end < addDays(one.date, -7)))
      ends.set(code, end)
  }
  const offers = new Map<string, { date: string; rate: string } | { why: Missed['why'] }>()
  await Promise.all(
    [...ends.entries()].map(async ([code, end]) => {
      const answer = await ctx.rateSource.rates({ from: code, to: HOME_CURRENCY, start: end, end })
      if (!answer.ok) {
        offers.set(code, { why: whyOf(answer.failure.code) })
        return
      }
      const onEnd = answer.value.find((one) => one.date === end)
      offers.set(code, onEnd === undefined ? { why: 'none' } : { date: end, rate: onEnd.rate })
    }),
  )

  // Read and written after the last wait, so another command can't announce half-way.
  const now = ctx.now()
  const docs: RateDoc[] = []
  const missed: Missed[] = []
  for (const one of input.days) {
    const rate = taken.get(`${one.date} ${one.currency}`)
    if (rate !== undefined) {
      const line = { date: one.date, currency: one.currency, rate: rate.rate }
      docs.push(rateDocOf(ctx, line, now, rate.date))
      continue
    }
    const last = lastOf.get(one.currency)
    const end = last !== undefined && 'end' in last ? last.end : null
    const besideEnd = end !== null && end < addDays(one.date, -7)
    const offer = offers.get(one.currency)
    if (input.last === true && besideEnd && offer !== undefined && 'date' in offer) {
      const line = { date: one.date, currency: one.currency, rate: offer.rate }
      docs.push(rateDocOf(ctx, line, now, offer.date))
      continue
    }
    const refusedHere = refused.get(one.currency)
    const offerWhy = besideEnd && offer !== undefined && 'why' in offer ? offer.why : undefined
    const lastWhy = last !== undefined && 'why' in last ? last.why : 'none'
    missed.push({
      date: one.date,
      currency: one.currency,
      why: refusedHere ?? offerWhy ?? lastWhy,
      offer:
        besideEnd && offer !== undefined && 'date' in offer
          ? { date: offer.date, rate: offer.rate }
          : null,
    })
  }
  if (docs.length === 0) return { ok: true, value: { ids: [], missed } }
  const { applied, changes } = applyKeeping(ctx, docs, now, docs)
  record(ctx, { action: 'fetchRates', count: docs.length }, changes)
  return outcomeOf(applied, { ids: docs.map((doc) => doc.id), missed })
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
