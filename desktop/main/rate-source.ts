// The app's one call out: the rates the ECB published, from frankfurter.dev, when I allow it.
// Ported from the current app's backend/src/fx/rate-source.ts, onto Frankfurter's v2.

import { isCalendarDate } from '@have-fish/core/calendar-date'
import { PLAIN_RATE } from '@have-fish/core/documents'
import { failure, type Outcome } from '@have-fish/core/outcome'
import { readRate } from '@have-fish/core/rates'
import { z } from 'zod'

/** Where the published rates come from: the ECB's, through Frankfurter's v2. */
export const RATES_URL = 'https://api.frankfurter.dev/v2/rates'

/** The service a run asks: a development run may point it elsewhere, a packaged one never. */
export function ratesUrlFor(isPackaged: boolean, env: Record<string, string | undefined>): string {
  return isPackaged ? RATES_URL : env.HAVE_FISH_RATES_URL || RATES_URL
}

/** One currency into another. */
export type RatePair = { from: string; to: string }

/** What a fetch asks for: one currency's rates into another, over a span of days. */
export type RateAsk = RatePair & { start: string; end: string }

/** A day the service published a rate, and the rate as its text was sent. */
export type PublishedRate = { date: string; rate: string }

/** The service: each day's published rates over a span, and the last day it published a pair. */
export type RateSource = {
  rates(ask: RateAsk): Promise<Outcome<PublishedRate[]>>
  lastDay(pair: RatePair): Promise<Outcome<string | null>>
}

/** Asks the service; answers a refusal, never a rejection, and logs nothing. */
export function ratesFrom(url: string, timeoutMs = 10_000): RateSource {
  return {
    async rates(ask) {
      const at = urlAt(url, '', {
        base: ask.from,
        quotes: ask.to,
        from: ask.start,
        to: ask.end,
        providers: 'ecb',
      })
      if (at === null) return failure('RATES_NOT_FETCHED')
      const answer = await request(at, (text) => ratesIn(text, ask), [422], timeoutMs)
      return answer.ok ? { ok: true, value: answer.value ?? [] } : answer
    },
    lastDay(pair) {
      const at = urlAt(url, 'coverage', {
        base: pair.from,
        quotes: pair.to,
        providers: 'ecb',
      })
      if (at === null) return Promise.resolve(failure('RATES_NOT_FETCHED'))
      return request(at, lastDayIn, [404, 422], timeoutMs)
    },
  }
}

/** `path` under the service at `url` with `search`, or null where `url` is no address. */
function urlAt(url: string, path: string, search: Record<string, string>): URL | null {
  try {
    const at = new URL(path, url)
    for (const [key, value] of Object.entries(search)) at.searchParams.set(key, value)
    return at
  } catch {
    return null
  }
}

/**
 * Asks `at` and reads its answer: a status in `none` is no answer, `null`; another failed one, a
 * timeout or a throw is a refusal; and a text `read` can't read is a different one.
 */
async function request<T>(
  at: URL,
  read: (text: string) => T | null,
  none: readonly number[],
  timeoutMs: number,
): Promise<Outcome<T | null>> {
  try {
    const answer = await fetch(at, { signal: AbortSignal.timeout(timeoutMs) })
    if (none.includes(answer.status)) return { ok: true, value: null }
    if (!answer.ok) return failure('RATES_NOT_FETCHED')
    const value = read(await answer.text())
    return value === null ? failure('RATES_UNREADABLE') : { ok: true, value }
  } catch {
    // The error can name the URL, which holds the days and codes: none of it is kept.
    return failure('RATES_NOT_FETCHED')
  }
}

// lib.es5 types the reviver with two arguments; Node 21 and later pass a third, the source text.
type Reviver = (key: string, value: unknown, context: { source?: string }) => unknown
const parseKeeping = JSON.parse as (text: string, reviver: Reviver) => unknown

/** Every entry of an answer: its rate is the number's text as sent, never a float's. */
const ANSWER = z.array(
  z.object({
    date: z.string(),
    base: z.string(),
    quote: z.string(),
    rate: z.string(),
  }),
)

/** The rates in the service's answer, or null where it isn't one for `ask` the ledger takes. */
function ratesIn(text: string, ask: RateAsk): PublishedRate[] | null {
  const parsed = dataOf(text)
  if (parsed === null) return null
  const answer = ANSWER.safeParse(parsed)
  if (!answer.success) return null
  const rates: PublishedRate[] = []
  for (const entry of answer.data) {
    if (entry.base !== ask.from || entry.quote !== ask.to) return null
    if (!isCalendarDate(entry.date)) return null
    if (!PLAIN_RATE.test(entry.rate) || !readRate(entry.rate).ok) return null
    rates.push({ date: entry.date, rate: entry.rate })
  }
  return rates
}

/** The coverage's last day, or null where it isn't one the calendar has. */
const COVERAGE = z.object({ end_date: z.string() })

function lastDayIn(text: string): string | null {
  const answer = COVERAGE.safeParse(dataOf(text))
  return answer.success && isCalendarDate(answer.data.end_date) ? answer.data.end_date : null
}

/** The text as data, its numbers kept as their own text, or null where it isn't an answer. */
function dataOf(text: string): unknown {
  try {
    return parseKeeping(text, (_key, value, context) =>
      typeof value === 'number' ? context.source : value,
    )
  } catch {
    return null
  }
}
