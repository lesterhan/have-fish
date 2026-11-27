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

/** What a fetch asks for: one currency's rates into another, over a span of days. */
export type RateAsk = { from: string; to: string; start: string; end: string }

/** A day the service published a rate, and the rate as its text was sent. */
export type PublishedRate = { date: string; rate: string }

/** Each day the service published a rate from `from` to `to`; none for one it doesn't quote. */
export type RateSource = (ask: RateAsk) => Promise<Outcome<PublishedRate[]>>

/** Asks the service; answers a refusal, never a rejection, and logs nothing. */
export function ratesFrom(url: string, timeoutMs = 10_000): RateSource {
  return async (ask) => {
    try {
      const at = new URL(url)
      at.searchParams.set('base', ask.from)
      at.searchParams.set('quotes', ask.to)
      at.searchParams.set('from', ask.start)
      at.searchParams.set('to', ask.end)
      at.searchParams.set('providers', 'ecb')
      const answer = await fetch(at, { signal: AbortSignal.timeout(timeoutMs) })
      if (answer.status === 422) return { ok: true, value: [] }
      if (!answer.ok) return failure('RATES_NOT_FETCHED')
      const rates = ratesIn(await answer.text(), ask)
      return rates === null ? failure('RATES_NOT_FETCHED') : { ok: true, value: rates }
    } catch {
      // The error can name the URL, which holds the days and codes: none of it is kept.
      return failure('RATES_NOT_FETCHED')
    }
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
  const parsed = parseKeeping(text, (_key, value, context) =>
    typeof value === 'number' ? context.source : value,
  )
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
