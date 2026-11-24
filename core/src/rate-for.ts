// The rate for one amount, best first, with how good it is: what a report converts by.

import { firstAfter } from './calendar-date'
import type { RateDoc } from './documents'
import { costOn, type Pools } from './pool'
import { invert, type Rate, ratio, readRate } from './rates'
import type { Shape } from './shapes'

/** How good a rate is, best first: the order a total takes its weakest from. */
export const MARKS = ['exact', 'cost', 'mine', 'estimate', 'borrowed', 'missing'] as const

export type Mark = (typeof MARKS)[number]

/** A rate and how good it is; a borrowed one says its day, and a missing one has none. */
export type MarkedRate =
  | { readonly mark: 'exact' | 'cost' | 'mine' | 'estimate'; readonly rate: Rate }
  | { readonly mark: 'borrowed'; readonly rate: Rate; readonly day: string }
  | { readonly mark: 'missing' }

/** One day of a currency's rate documents into `into`: the one I typed, the one fetched. */
export type BookDay = {
  readonly date: string
  readonly mine: Rate | null
  readonly fetched: Rate | null
}

/** Each currency's days of rate documents, by code, in order of day. */
export type RateBook = ReadonlyMap<string, readonly BookDay[]>

/** The ledger's rates into `into`, either way round, by currency and day; no tombstones. */
export function rateBookOf(docs: readonly RateDoc[], into: string): RateBook {
  const byCurrency = new Map<string, Map<string, BookDay>>()
  for (const doc of docs) {
    if (doc.deletedAt !== null) continue
    const inverted = doc.from === into
    if (!inverted && doc.to !== into) continue
    const read = readRate(doc.rate)
    if (!read.ok) continue
    const currency = inverted ? doc.to : doc.from
    const rate = inverted ? invert(read.value) : read.value
    const typed = doc.origin.source === 'manual'
    const currencyDays = byCurrency.get(currency) ?? new Map<string, BookDay>()
    byCurrency.set(currency, currencyDays)
    const day = currencyDays.get(doc.date) ?? { date: doc.date, mine: null, fetched: null }
    currencyDays.set(doc.date, typed ? { ...day, mine: rate } : { ...day, fetched: rate })
  }

  const book = new Map<string, readonly BookDay[]>()
  for (const [currency, currencyDays] of byCurrency) {
    const inOrder = [...currencyDays.values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    )
    book.set(currency, inOrder)
  }
  return book
}

/** The best rate for one amount into `into`: its own, the pool, mine, fetched, the nearest. */
export function rateFor(
  amount: { currency: string; date: string; own: Rate | null },
  pools: Pools,
  book: RateBook,
  into: string,
): MarkedRate {
  if (amount.currency === into) return { mark: 'exact', rate: { num: 1n, den: 1n } }
  if (amount.own !== null) return { mark: 'exact', rate: amount.own }

  const found = costOn(pools, amount.currency, amount.date)
  if (found !== null && found.rate !== null) return { mark: 'cost', rate: found.rate }

  const days = book.get(amount.currency) ?? []
  const next = firstAfter(days, amount.date)
  const onOrBefore = days[next - 1]
  if (onOrBefore !== undefined && onOrBefore.date === amount.date) {
    if (onOrBefore.mine !== null) return { mark: 'mine', rate: onOrBefore.mine }
    if (onOrBefore.fetched !== null) return { mark: 'estimate', rate: onOrBefore.fetched }
  }

  const near = nearest(onOrBefore, days[next], amount.date)
  if (near !== null) {
    const rate = near.mine ?? near.fetched
    if (rate !== null) return { mark: 'borrowed', rate, day: near.date }
  }
  return { mark: 'missing' }
}

/** A converted spend's own rate, when it paid in `into`; null for anything else. */
export function ownRate(shape: Shape, into: string): Rate | null {
  if (shape.shape !== 'converted' || shape.from.currency !== into) return null
  return ratio(shape.to.cents, -shape.from.cents)
}

/** Whichever of the two days is nearer `date`, counted in days: the earlier on a tie. */
function nearest(
  earlier: BookDay | undefined,
  later: BookDay | undefined,
  date: string,
): BookDay | null {
  if (earlier === undefined) return later ?? null
  if (later === undefined) return earlier
  const back = dayNumber(date) - dayNumber(earlier.date)
  const ahead = dayNumber(later.date) - dayNumber(date)
  return back <= ahead ? earlier : later
}

/** The day `date` names, as a whole number of days since 1970: a month boundary counts as days. */
function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000
}
